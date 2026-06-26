
CREATE TYPE public.inventory_count_status AS ENUM ('draft', 'in_progress', 'closed', 'cancelled');

CREATE TABLE public.inventory_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  status public.inventory_count_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID,
  closed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

CREATE INDEX idx_inventory_counts_tenant ON public.inventory_counts(tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_counts TO authenticated;
GRANT ALL ON public.inventory_counts TO service_role;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view inventory counts" ON public.inventory_counts FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Managers create inventory counts" ON public.inventory_counts FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'));
CREATE POLICY "Managers update inventory counts" ON public.inventory_counts FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'));
CREATE POLICY "Owners delete inventory counts" ON public.inventory_counts FOR DELETE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'));

CREATE TRIGGER trg_inventory_counts_updated BEFORE UPDATE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.inventory_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  system_qty NUMERIC NOT NULL DEFAULT 0,
  physical_qty NUMERIC,
  variance NUMERIC GENERATED ALWAYS AS (COALESCE(physical_qty, 0) - system_qty) STORED,
  counted_by UUID,
  counted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_id, product_id)
);

CREATE INDEX idx_inventory_count_items_count ON public.inventory_count_items(count_id);
CREATE INDEX idx_inventory_count_items_tenant ON public.inventory_count_items(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_items TO authenticated;
GRANT ALL ON public.inventory_count_items TO service_role;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view count items" ON public.inventory_count_items FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Managers insert count items" ON public.inventory_count_items FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'));
CREATE POLICY "Managers update count items" ON public.inventory_count_items FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'));
CREATE POLICY "Managers delete count items" ON public.inventory_count_items FOR DELETE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'));

CREATE TRIGGER trg_inventory_count_items_updated BEFORE UPDATE ON public.inventory_count_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Populate items from current product catalog and snapshot system qty
CREATE OR REPLACE FUNCTION public.start_inventory_count(_count_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _status inventory_count_status;
  _store_id UUID;
  _inserted INTEGER;
BEGIN
  SELECT tenant_id, status, store_id INTO _tenant_id, _status, _store_id
  FROM public.inventory_counts WHERE id = _count_id;

  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'Inventory count not found'; END IF;
  IF NOT (public.has_tenant_role(auth.uid(), _tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), _tenant_id, 'manager')) THEN
    RAISE EXCEPTION 'Insufficient privileges';
  END IF;
  IF _status <> 'draft' THEN RAISE EXCEPTION 'Count already started'; END IF;

  INSERT INTO public.inventory_count_items (count_id, tenant_id, product_id, system_qty)
  SELECT _count_id, _tenant_id, p.id, public.get_product_stock(p.id)
  FROM public.products p
  WHERE p.tenant_id = _tenant_id AND p.is_active = true
  ON CONFLICT (count_id, product_id) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  UPDATE public.inventory_counts
  SET status = 'in_progress', started_at = now()
  WHERE id = _count_id;

  RETURN _inserted;
END;
$$;


-- Close count and post adjustment movements for non-zero variances
CREATE OR REPLACE FUNCTION public.close_inventory_count(_count_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _status inventory_count_status;
  _store_id UUID;
  _reference TEXT;
  _adjustments INTEGER := 0;
  _item RECORD;
BEGIN
  SELECT tenant_id, status, store_id, reference
  INTO _tenant_id, _status, _store_id, _reference
  FROM public.inventory_counts WHERE id = _count_id;

  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'Inventory count not found'; END IF;
  IF NOT (public.has_tenant_role(auth.uid(), _tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), _tenant_id, 'manager')) THEN
    RAISE EXCEPTION 'Insufficient privileges';
  END IF;
  IF _status = 'closed' THEN RAISE EXCEPTION 'Count already closed'; END IF;
  IF _status = 'cancelled' THEN RAISE EXCEPTION 'Count cancelled'; END IF;

  FOR _item IN
    SELECT product_id, variance
    FROM public.inventory_count_items
    WHERE count_id = _count_id AND physical_qty IS NOT NULL AND variance <> 0
  LOOP
    INSERT INTO public.stock_movements (
      tenant_id, store_id, product_id, movement_type, quantity, reason, reference, created_by
    ) VALUES (
      _tenant_id, _store_id, _item.product_id, 'adjustment', _item.variance,
      'Inventaire périodique', _reference, auth.uid()
    );
    _adjustments := _adjustments + 1;
  END LOOP;

  UPDATE public.inventory_counts
  SET status = 'closed', closed_at = now(), closed_by = auth.uid()
  WHERE id = _count_id;

  RETURN _adjustments;
END;
$$;
