CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action
  ON public.audit_logs (tenant_id, action);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_entity_created
  ON public.audit_logs (tenant_id, entity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_preset_name
  ON public.audit_logs ((metadata->>'preset_name'))
  WHERE entity = 'inventory_permission_preset';

ANALYZE public.audit_logs;