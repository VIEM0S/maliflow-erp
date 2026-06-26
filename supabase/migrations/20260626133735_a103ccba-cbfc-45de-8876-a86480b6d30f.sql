
CREATE TYPE public.inventory_permission AS ENUM ('create','start','close','cancel','adjust_item');

CREATE TABLE public.tenant_inventory_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permission public.inventory_permission NOT NULL,
  allowed_roles public.app_role[] NOT NULL DEFAULT ARRAY['manager']::public.app_role[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, permission)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_inventory_permissions TO authenticated;
GRANT ALL ON public.tenant_inventory_permissions TO service_role;
ALTER TABLE public.tenant_inventory_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read tenant permissions" ON public.tenant_inventory_permissions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Owners manage tenant permissions" ON public.tenant_inventory_permissions
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner'));

CREATE TRIGGER trg_tip_updated BEFORE UPDATE ON public.tenant_inventory_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Defaults for existing tenants
INSERT INTO public.tenant_inventory_permissions (tenant_id, permission, allowed_roles)
SELECT t.id, p.perm, ARRAY['manager']::public.app_role[]
FROM public.tenants t
CROSS JOIN (VALUES
  ('create'::public.inventory_permission),
  ('start'::public.inventory_permission),
  ('close'::public.inventory_permission),
  ('cancel'::public.inventory_permission),
  ('adjust_item'::public.inventory_permission)
) AS p(perm)
ON CONFLICT DO NOTHING;

-- Auto-seed on tenant creation
CREATE OR REPLACE FUNCTION public.seed_tenant_inventory_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tenant_inventory_permissions (tenant_id, permission, allowed_roles) VALUES
    (NEW.id, 'create', ARRAY['manager']::public.app_role[]),
    (NEW.id, 'start', ARRAY['manager']::public.app_role[]),
    (NEW.id, 'close', ARRAY['manager']::public.app_role[]),
    (NEW.id, 'cancel', ARRAY['manager']::public.app_role[]),
    (NEW.id, 'adjust_item', ARRAY['manager']::public.app_role[])
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_seed_tenant_inventory_perms
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_tenant_inventory_permissions();

-- Permission helper
CREATE OR REPLACE FUNCTION public.can_inventory(_user_id uuid, _tenant_id uuid, _permission public.inventory_permission)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = _user_id
        AND m.tenant_id = _tenant_id
        AND m.is_active = true
        AND (
          m.role = 'owner'
          OR EXISTS (
            SELECT 1 FROM public.tenant_inventory_permissions tip
            WHERE tip.tenant_id = _tenant_id
              AND tip.permission = _permission
              AND m.role = ANY(tip.allowed_roles)
          )
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_inventory(uuid, uuid, public.inventory_permission) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_inventory(uuid, uuid, public.inventory_permission) TO authenticated;

-- Replace policies on inventory_counts
DROP POLICY IF EXISTS "Managers create inventory counts" ON public.inventory_counts;
DROP POLICY IF EXISTS "Managers update inventory counts" ON public.inventory_counts;

CREATE POLICY "Permitted create inventory counts" ON public.inventory_counts
  FOR INSERT TO authenticated
  WITH CHECK (public.can_inventory(auth.uid(), tenant_id, 'create'));

CREATE POLICY "Permitted update inventory counts" ON public.inventory_counts
  FOR UPDATE TO authenticated
  USING (
    public.can_inventory(auth.uid(), tenant_id, 'create')
    OR public.can_inventory(auth.uid(), tenant_id, 'start')
    OR public.can_inventory(auth.uid(), tenant_id, 'close')
    OR public.can_inventory(auth.uid(), tenant_id, 'cancel')
  );

-- Replace policies on inventory_count_items
DROP POLICY IF EXISTS "Managers insert count items" ON public.inventory_count_items;
DROP POLICY IF EXISTS "Managers update count items" ON public.inventory_count_items;
DROP POLICY IF EXISTS "Managers delete count items" ON public.inventory_count_items;

CREATE POLICY "Permitted insert count items" ON public.inventory_count_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_inventory(auth.uid(), tenant_id, 'start'));

CREATE POLICY "Permitted update count items" ON public.inventory_count_items
  FOR UPDATE TO authenticated
  USING (public.can_inventory(auth.uid(), tenant_id, 'adjust_item'));

CREATE POLICY "Permitted delete count items" ON public.inventory_count_items
  FOR DELETE TO authenticated
  USING (public.can_inventory(auth.uid(), tenant_id, 'start'));

-- Update SECURITY DEFINER functions to honor the permission matrix
CREATE OR REPLACE FUNCTION public.start_inventory_count(_count_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant_id UUID; _status inventory_count_status; _inserted INTEGER;
BEGIN
  SELECT tenant_id, status INTO _tenant_id, _status FROM public.inventory_counts WHERE id = _count_id;
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'Inventory count not found'; END IF;
  IF NOT public.can_inventory(auth.uid(), _tenant_id, 'start') THEN
    RAISE EXCEPTION 'Insufficient privileges';
  END IF;
  IF _status <> 'draft' THEN RAISE EXCEPTION 'Count already started'; END IF;

  INSERT INTO public.inventory_count_items (count_id, tenant_id, product_id, system_qty)
  SELECT _count_id, _tenant_id, p.id, public.get_product_stock(p.id)
  FROM public.products p WHERE p.tenant_id = _tenant_id AND p.is_active = true
  ON CONFLICT (count_id, product_id) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  UPDATE public.inventory_counts SET status = 'in_progress', started_at = now() WHERE id = _count_id;
  RETURN _inserted;
END;$$;

CREATE OR REPLACE FUNCTION public.close_inventory_count(_count_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant_id UUID; _status inventory_count_status; _store_id UUID; _reference TEXT;
  _adjustments INTEGER := 0; _item RECORD;
BEGIN
  SELECT tenant_id, status, store_id, reference INTO _tenant_id, _status, _store_id, _reference
  FROM public.inventory_counts WHERE id = _count_id;
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'Inventory count not found'; END IF;
  IF NOT public.can_inventory(auth.uid(), _tenant_id, 'close') THEN
    RAISE EXCEPTION 'Insufficient privileges';
  END IF;
  IF _status = 'closed' THEN RAISE EXCEPTION 'Count already closed'; END IF;
  IF _status = 'cancelled' THEN RAISE EXCEPTION 'Count cancelled'; END IF;

  FOR _item IN
    SELECT product_id, variance FROM public.inventory_count_items
    WHERE count_id = _count_id AND physical_qty IS NOT NULL AND variance <> 0
  LOOP
    INSERT INTO public.stock_movements (tenant_id, store_id, product_id, movement_type, quantity, reason, reference, created_by)
    VALUES (_tenant_id, _store_id, _item.product_id, 'adjustment', _item.variance, 'Inventaire périodique', _reference, auth.uid());
    _adjustments := _adjustments + 1;
  END LOOP;

  UPDATE public.inventory_counts SET status = 'closed', closed_at = now(), closed_by = auth.uid() WHERE id = _count_id;
  RETURN _adjustments;
END;$$;
