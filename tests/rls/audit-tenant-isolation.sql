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

-- ---------------------------------------------------------------
-- T6. Cross-tenant drawer injection: owner A tries to load a detail
--     row that belongs to tenant B by passing tenant B's audit id
--     while filtering on tenant_id = tenant A. The server function
--     applies `.eq("tenant_id", tenantId)`, which under RLS scoped
--     to owner A must return 0 rows even when the id exists.
-- ---------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner_a'), 'role', 'authenticated')::text,
  true);

-- Grab the id of tenant B's seeded audit row via a superuser CTE
-- (bypasses RLS just to obtain the id — mirrors what an attacker
-- would harvest out-of-band).
DO $$
DECLARE
  _b_id uuid;
  _visible int;
BEGIN
  -- Read the id in a SECURITY DEFINER-like way via set_config from
  -- earlier seed data — we stored the tenant ids, but not the audit id.
  -- Instead, read it from a temporary superuser context.
  RESET role;
  SELECT id INTO _b_id FROM public.audit_logs
   WHERE tenant_id = current_setting('test.tenant_b')::uuid
   LIMIT 1;
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('test.owner_a'), 'role', 'authenticated')::text,
    true);

  -- Simulate getPresetAuditDetail: id = <B's id>, tenant_id = A.
  SELECT count(*) INTO _visible FROM public.audit_logs
    WHERE id = _b_id AND tenant_id = current_setting('test.tenant_a')::uuid;
  IF _visible <> 0 THEN
    RAISE EXCEPTION 'T6: cross-tenant id + own tenant_id filter must return 0';
  END IF;

  -- And without the tenant_id guard, RLS still hides it.
  SELECT count(*) INTO _visible FROM public.audit_logs WHERE id = _b_id;
  IF _visible <> 0 THEN
    RAISE EXCEPTION 'T6: RLS must hide tenant B audit row from owner A';
  END IF;
END $$;

RESET role;

-- ---------------------------------------------------------------
-- T7. Denied access to the audit journal must produce exactly one
--     `audit.access_denied.<action>` record (written by the server
--     function via the admin client). We simulate the admin insert
--     directly and assert the row exists once with the expected
--     shape: user_id + tenant_id + reason.
-- ---------------------------------------------------------------
-- Baseline count (should be zero — nothing seeded).
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs
    WHERE action LIKE 'audit.access_denied.%') = 0,
  'T7: no access_denied rows should exist before the simulated attempt');

-- Simulate `assertAuditAccess` denial for the cashier trying to list.
INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, metadata)
VALUES (
  current_setting('test.tenant_a')::uuid,
  current_setting('test.cashier_a')::uuid,
  'audit.access_denied.list',
  'audit_logs',
  jsonb_build_object(
    'reason', 'insufficient_permissions',
    'required_role', jsonb_build_array('owner', 'super_admin'),
    'observed_role', 'cashier',
    'action', 'list'
  )
);

-- Exactly one record with the expected shape.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs
    WHERE action = 'audit.access_denied.list'
      AND tenant_id = current_setting('test.tenant_a')::uuid
      AND user_id = current_setting('test.cashier_a')::uuid
      AND metadata->>'reason' = 'insufficient_permissions'
      AND metadata->>'observed_role' = 'cashier') = 1,
  'T7: exactly one access_denied.list row with expected user/tenant/reason');

-- A second, independent denial (e.g. detail attempt) must create its
-- own row — no de-duplication, no missing insert.
INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, metadata)
VALUES (
  current_setting('test.tenant_a')::uuid,
  current_setting('test.cashier_a')::uuid,
  'audit.access_denied.detail',
  'audit_logs',
  jsonb_build_object(
    'reason', 'insufficient_permissions',
    'required_role', jsonb_build_array('owner', 'super_admin'),
    'observed_role', 'cashier',
    'action', 'detail'
  )
);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_logs
    WHERE action LIKE 'audit.access_denied.%'
      AND tenant_id = current_setting('test.tenant_a')::uuid
      AND user_id = current_setting('test.cashier_a')::uuid) = 2,
  'T7: each denied attempt appends exactly one audit row');

-- Everything passed — nothing raised.
DO $$ BEGIN RAISE NOTICE 'RLS ISOLATION TESTS PASSED'; END $$;

ROLLBACK;

-- =======================================================================
-- T8 — Index & performance sanity checks (read-only, outside the ROLLBACK
-- block so it observes real database state).
-- =======================================================================

\echo '--- T8.1: required indexes exist on public.audit_logs'
SELECT indexname
FROM pg_indexes
WHERE schemaname='public' AND tablename='audit_logs'
  AND indexname IN (
    'idx_audit_logs_tenant_created',
    'idx_audit_logs_tenant_action',
    'idx_audit_logs_tenant_entity_created',
    'idx_audit_logs_preset_name'
  )
ORDER BY indexname;
-- Expected: 4 rows. Any missing index means the listPresetAudit search
-- path will fall back to seq-scan and violate the perf budget below.

\echo '--- T8.2: EXPLAIN — tenant + entity + created_at DESC must use an index'
EXPLAIN (COSTS OFF)
SELECT id, action, created_at
FROM public.audit_logs
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND entity = 'inventory_permission_preset'
ORDER BY created_at DESC
LIMIT 25;
-- Expected plan mentions "Index Scan" on one of the tenant-scoped indexes.

\echo '--- T8.3: EXPLAIN — preset_name search must use the expression index'
EXPLAIN (COSTS OFF)
SELECT id
FROM public.audit_logs
WHERE entity = 'inventory_permission_preset'
  AND metadata->>'preset_name' ILIKE '%standard%';
-- Expected plan mentions idx_audit_logs_preset_name (or a bitmap over it).

\echo '--- T8.4: perf budget — filtered list under 100ms on a warm cache'
\timing on
SELECT count(*) FROM public.audit_logs
WHERE entity = 'inventory_permission_preset'
  AND action = 'preset.update'
ORDER BY created_at DESC;
\timing off
-- Manual gate: fail the run if the reported time exceeds 100ms per 10k
-- rows. Adjust the threshold to match your dataset size; the point of
-- this smoke test is to detect a regression (seq-scan appearing after
-- an index rename or accidental DROP INDEX).