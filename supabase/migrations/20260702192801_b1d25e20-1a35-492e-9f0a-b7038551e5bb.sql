
-- Tenants: scope INSERT policy to authenticated role explicitly
DROP POLICY IF EXISTS tenants_insert_self ON public.tenants;
CREATE POLICY tenants_insert_self ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND auth.uid() IS NOT NULL);

-- Audit logs: re-affirm owner-only SELECT + member-only INSERT, both scoped to authenticated
DROP POLICY IF EXISTS audit_select_owner ON public.audit_logs;
CREATE POLICY audit_select_owner ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (tenant_id IS NULL AND public.is_super_admin(auth.uid()))
    OR (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'owner'::public.app_role))
    OR (tenant_id IS NOT NULL AND public.is_super_admin(auth.uid()))
  );

DROP POLICY IF EXISTS audit_insert_member ON public.audit_logs;
CREATE POLICY audit_insert_member ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id))
  );

-- Explicitly block anon from audit_logs at the grant level (defense in depth)
REVOKE ALL ON public.audit_logs FROM anon;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
