-- Presets of inventory permission matrices, reusable across tenants by their creator
CREATE TABLE public.inventory_permission_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- payload shape: { "create": ["manager","cashier"], "start": [...], ... }
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_permission_presets TO authenticated;
GRANT ALL ON public.inventory_permission_presets TO service_role;

ALTER TABLE public.inventory_permission_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own presets"
  ON public.inventory_permission_presets
  FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE TRIGGER trg_inventory_permission_presets_updated_at
  BEFORE UPDATE ON public.inventory_permission_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
