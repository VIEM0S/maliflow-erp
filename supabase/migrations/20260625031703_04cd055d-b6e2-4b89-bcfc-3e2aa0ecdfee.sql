
CREATE TYPE public.stock_movement_type AS ENUM ('in', 'out', 'adjustment');

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  movement_type public.stock_movement_type NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2),
  reason TEXT,
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_qty_positive CHECK (quantity > 0)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sm_select" ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "sm_insert" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager')
  );
CREATE POLICY "sm_delete" ON public.stock_movements FOR DELETE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'));

CREATE INDEX idx_sm_tenant ON public.stock_movements(tenant_id);
CREATE INDEX idx_sm_product ON public.stock_movements(product_id);
CREATE INDEX idx_sm_created ON public.stock_movements(tenant_id, created_at DESC);

-- View: signed balance per product per tenant
CREATE VIEW public.product_stock_balances
WITH (security_invoker = true)
AS
SELECT
  p.tenant_id,
  p.id AS product_id,
  p.sku,
  p.name,
  p.unit,
  p.min_stock,
  COALESCE(SUM(
    CASE
      WHEN m.movement_type = 'in' THEN m.quantity
      WHEN m.movement_type = 'out' THEN -m.quantity
      WHEN m.movement_type = 'adjustment' THEN m.quantity
    END
  ), 0)::NUMERIC(14,3) AS on_hand,
  COALESCE(SUM(
    CASE
      WHEN m.movement_type IN ('in','adjustment') AND m.unit_cost IS NOT NULL
        THEN m.quantity * m.unit_cost
      WHEN m.movement_type = 'out' AND m.unit_cost IS NOT NULL
        THEN -m.quantity * m.unit_cost
      ELSE 0
    END
  ), 0)::NUMERIC(14,2) AS stock_value
FROM public.products p
LEFT JOIN public.stock_movements m ON m.product_id = p.id
GROUP BY p.tenant_id, p.id, p.sku, p.name, p.unit, p.min_stock;

GRANT SELECT ON public.product_stock_balances TO authenticated;
GRANT SELECT ON public.product_stock_balances TO service_role;

-- Helper function
CREATE OR REPLACE FUNCTION public.get_product_stock(_product_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN movement_type = 'in' THEN quantity
      WHEN movement_type = 'out' THEN -quantity
      WHEN movement_type = 'adjustment' THEN quantity
    END
  ), 0)
  FROM public.stock_movements
  WHERE product_id = _product_id;
$$;
