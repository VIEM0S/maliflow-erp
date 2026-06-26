
REVOKE EXECUTE ON FUNCTION public.start_inventory_count(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_inventory_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_inventory_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_inventory_count(UUID) TO authenticated;
