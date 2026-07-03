-- =======================================================================
-- Multi-tenant RLS isolation tests for `audit_logs` and `tenants`.
--
-- Run with:   bash tests/rls/run.sh
--
-- The script:
--   * creates 3 auth users (owner A, owner B, cashier of A)
--   * creates 2 tenants (A owned by user A, B owned by user B)
--   * seeds one audit_logs entry per tenant
--   * impersonates each user via `SET LOCAL role authenticated` +
--     `SET LOCAL request.jwt.claims` so RLS policies apply as in production
--   * asserts expected visibility and rejects cross-tenant / cross-user
--     access
--
-- The whole block runs in a transaction and is ROLLED BACK at the end —
-- no residual data.
-- =======================================================================

BEGIN;

-- Helper: raise if a boolean assertion is false.
CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, msg text) RETURNS void AS $$
BEGIN
  IF NOT cond THEN RAISE EXCEPTION 'ASSERTION FAILED: %', msg; END IF;
END; $$ LANGUAGE plpgsql;

-- Fresh test identities.
WITH new_users AS (
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-owner-a@test.local', crypt('x', gen_salt('bf')), now(), now(), now()),
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-owner-b@test.local', crypt('x', gen_salt('bf')), now(), now(), now()),
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-cashier-a@test.local', crypt('x', gen_salt('bf')), now(), now(), now())
  RETURNING id, email
)
SELECT set_config('test.owner_a', (SELECT id::text FROM new_users WHERE email = 'rls-owner-a@test.local'), false),
       set_config('test.owner_b', (SELECT id::text FROM new_users WHERE email = 'rls-owner-b@test.local'), false),
       set_config('test.cashier_a', (SELECT id::text FROM new_users WHERE email = 'rls-cashier-a@test.local'), false);

-- Two tenants with owner + one cashier of A.
INSERT INTO public.tenants (id, name, slug, created_by)
VALUES (gen_random_uuid(), 'Tenant A', 'rls-tenant-a', current_setting('test.owner_a')::uuid),
       (gen_random_uuid(), 'Tenant B', 'rls-tenant-b', current_setting('test.owner_b')::uuid);

SELECT set_config('test.tenant_a', (SELECT id::text FROM public.tenants WHERE slug='rls-tenant-a'), false),
       set_config('test.tenant_b', (SELECT id::text FROM public.tenants WHERE slug='rls-tenant-b'), false);

INSERT INTO public.memberships (user_id, tenant_id, role, is_active) VALUES
  (current_setting('test.owner_a')::uuid,  current_setting('test.tenant_a')::uuid, 'owner',   true),
  (current_setting('test.owner_b')::uuid,  current_setting('test.tenant_b')::uuid, 'owner',   true),
  (current_setting('test.cashier_a')::uuid, current_setting('test.tenant_a')::uuid, 'cashier', true);

INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, metadata) VALUES
  (current_setting('test.tenant_a')::uuid, current_setting('test.owner_a')::uuid,
   'preset.create', 'inventory_permission_preset', jsonb_build_object('preset_name','A-seed')),
  (current_setting('test.tenant_b')::uuid, current_setting('test.owner_b')::uuid,
   'preset.create', 'inventory_permission_preset', jsonb_build_object('preset_name','B-seed'));

-- ---------------------------------------------------------------
-- T1. Owner A sees ONLY tenant A audit rows.
-- ---------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner_a'), 'role', 'authenticated')::text,
  true);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs WHERE tenant_id = current_setting('test.tenant_a')::uuid) = 1,
  'T1: owner A must see tenant A audit');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs WHERE tenant_id = current_setting('test.tenant_b')::uuid) = 0,
  'T1: owner A must NOT see tenant B audit');

-- Owner A also sees tenant A row via `tenants` (member visibility).
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.tenants WHERE id = current_setting('test.tenant_a')::uuid) = 1,
  'T1: owner A must read tenant A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.tenants WHERE id = current_setting('test.tenant_b')::uuid) = 0,
  'T1: owner A must NOT read tenant B');

-- ---------------------------------------------------------------
-- T2. Owner B sees ONLY tenant B audit rows.
-- ---------------------------------------------------------------
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner_b'), 'role', 'authenticated')::text,
  true);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs WHERE tenant_id = current_setting('test.tenant_b')::uuid) = 1,
  'T2: owner B must see tenant B audit');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs WHERE tenant_id = current_setting('test.tenant_a')::uuid) = 0,
  'T2: owner B must NOT see tenant A audit');

-- ---------------------------------------------------------------
-- T3. Cashier of tenant A is a member but NOT owner → 0 audit rows.
-- ---------------------------------------------------------------
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.cashier_a'), 'role', 'authenticated')::text,
  true);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs) = 0,
  'T3: cashier must NOT see any audit rows (audit_select_owner requires owner)');

-- Cashier CAN still insert an audit entry for himself (audit_insert_member).
INSERT INTO public.audit_logs (tenant_id, user_id, action, entity)
VALUES (current_setting('test.tenant_a')::uuid, current_setting('test.cashier_a')::uuid,
        'test.self', 'test');

-- But NOT on behalf of someone else (user_id mismatch).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, entity)
    VALUES (current_setting('test.tenant_a')::uuid, current_setting('test.owner_a')::uuid,
            'test.spoof', 'test');
    RAISE EXCEPTION 'T3: cashier was able to spoof user_id — RLS FAILURE';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    -- expected
    NULL;
  END;
END $$;

-- ---------------------------------------------------------------
-- T4. Tenants INSERT policy: created_by MUST equal auth.uid().
-- ---------------------------------------------------------------
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner_a'), 'role', 'authenticated')::text,
  true);

-- Positive case: owner A creates a tenant for himself.
INSERT INTO public.tenants (name, slug, created_by)
VALUES ('Tenant A-2', 'rls-tenant-a2', current_setting('test.owner_a')::uuid);

-- Negative case: owner A tries to create a tenant on behalf of owner B.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tenants (name, slug, created_by)
    VALUES ('Fraud', 'rls-tenant-fraud', current_setting('test.owner_b')::uuid);
    RAISE EXCEPTION 'T4: RLS allowed created_by spoofing — FAILURE';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END $$;

-- ---------------------------------------------------------------
-- T5. Anonymous role is completely locked out.
-- ---------------------------------------------------------------
RESET role;
SET LOCAL role anon;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs) = 0,
  'T5: anon must not see any audit row');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.tenants) = 0,
  'T5: anon must not see any tenant row');

RESET role;

-- Everything passed — nothing raised.
DO $$ BEGIN RAISE NOTICE 'RLS ISOLATION TESTS PASSED'; END $$;

ROLLBACK;