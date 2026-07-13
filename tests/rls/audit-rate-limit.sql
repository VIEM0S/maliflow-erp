-- ============================================================================
-- T9 — Rate limit ne contourne pas la RLS ni les filtres search/actionFilter.
-- Vérifie que :
--   1) `audit.access.hit.list` et `audit.rate_limited.list` sont bien soumis
--      aux mêmes politiques `audit_select_owner` (aucune fuite cross-tenant).
--   2) Quand un utilisateur dépasse `RATE_LIMIT_MAX` hits en < 60s, une
--      entrée `audit.rate_limited.list` avec la raison `rate_limit_exceeded`
--      est visible pour l'owner du tenant concerné (et lui seul).
-- ============================================================================
BEGIN;
SET LOCAL client_min_messages = WARNING;

-- Réutilise les utilisateurs T1/T2 semés par audit-tenant-isolation.sql :
-- owner_a / tenant_a / owner_b / tenant_b. Si absents, ce script échoue vite.
DO $$
DECLARE
  v_tenant uuid;
  v_user   uuid;
  v_count  int;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE name = 'RLS Test Tenant A' LIMIT 1;
  SELECT id INTO v_user   FROM auth.users     WHERE email = 'rls-owner-a@test.local' LIMIT 1;
  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Prerequisite fixtures missing — run audit-tenant-isolation.sql first';
  END IF;

  -- Simule 61 hits (au-dessus du plafond de 60/min) sur une fenêtre courte.
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, metadata)
  SELECT v_tenant, v_user, 'audit.access.hit.list', 'audit_logs',
         jsonb_build_object('op','list','window_ms',60000,'limit',60)
  FROM generate_series(1, 61);

  -- Simule le refus enregistré par assertRateLimit.
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, metadata)
  VALUES (v_tenant, v_user, 'audit.rate_limited.list', 'audit_logs',
          jsonb_build_object('reason','rate_limit_exceeded','op','list',
                             'window_ms',60000,'limit',60,'observed',61));

  -- Vérifie qu'un OWNER voit exactement 1 entrée rate_limited pour ce tenant.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role','authenticated')::text, true);
  SET LOCAL role authenticated;

  SELECT count(*) INTO v_count FROM public.audit_logs
    WHERE tenant_id = v_tenant
      AND action   = 'audit.rate_limited.list'
      AND (metadata->>'reason') = 'rate_limit_exceeded';
  ASSERT v_count = 1,
    format('T9.1 owner should see exactly 1 rate_limited entry, got %s', v_count);

  RESET role;

  -- Vérifie l'isolation cross-tenant : owner du tenant B ne voit rien.
  SELECT id INTO v_user FROM auth.users WHERE email = 'rls-owner-b@test.local' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role','authenticated')::text, true);
  SET LOCAL role authenticated;
  SELECT count(*) INTO v_count FROM public.audit_logs
    WHERE action = 'audit.rate_limited.list' AND tenant_id = v_tenant;
  ASSERT v_count = 0, format('T9.2 cross-tenant leak: got %s', v_count);
  RESET role;

  RAISE NOTICE 'T9 RATE LIMIT RLS TESTS PASSED';
END $$;

ROLLBACK;
