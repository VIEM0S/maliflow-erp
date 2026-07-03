-- Read-only smoke tests — safe to run against any environment.
-- Validates the invariants documented in docs/security/rls-audit-and-tenants.md.

\echo '--- Invariant 1: tenants.created_by IS NOT NULL'
SELECT count(*) AS orphan_tenants FROM public.tenants WHERE created_by IS NULL;

\echo '--- Invariant 2: every tenant creator is an active owner of that tenant'
SELECT t.id, t.slug, t.created_by
FROM public.tenants t
LEFT JOIN public.memberships m
  ON m.tenant_id = t.id
 AND m.user_id = t.created_by
 AND m.role = 'owner'
 AND m.is_active = true
WHERE m.id IS NULL;

\echo '--- Invariant 3: audit_logs GRANTs (anon must NOT have SELECT)'
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='audit_logs'
ORDER BY grantee, privilege_type;

\echo '--- Invariant 4: audit_select_owner policy is defined and scoped to authenticated'
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname='public' AND tablename='audit_logs' AND policyname='audit_select_owner';

\echo '--- Invariant 5: tenants_insert_self policy enforces created_by = auth.uid()'
SELECT policyname, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='tenants' AND policyname='tenants_insert_self';