
-- Enums
CREATE TYPE public.app_role AS ENUM ('super_admin', 'owner', 'manager', 'cashier');
CREATE TYPE public.tenant_status AS ENUM ('trialing', 'active', 'suspended', 'cancelled');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'fr',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Tenants (entreprises)
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  rccm TEXT,
  nif TEXT,
  address TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'ML',
  currency TEXT NOT NULL DEFAULT 'XOF',
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  status public.tenant_status NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Memberships (user <-> tenant <-> role)
CREATE TABLE public.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  store_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);
CREATE INDEX idx_memberships_user ON public.memberships(user_id);
CREATE INDEX idx_memberships_tenant ON public.memberships(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Stores (magasins)
CREATE TABLE public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stores_tenant ON public.stores(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  metadata JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON public.audit_logs(tenant_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Security definer: has tenant role
CREATE OR REPLACE FUNCTION public.has_tenant_role(_user_id UUID, _tenant_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND role = _role AND is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user_id AND role = 'super_admin' AND is_active = true
  )
$$;

-- RLS policies
CREATE POLICY "tenants_select_member" ON public.tenants FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), id) OR public.is_super_admin(auth.uid()));
CREATE POLICY "tenants_insert_self" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "tenants_update_owner" ON public.tenants FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), id, 'owner') OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), id, 'owner') OR public.is_super_admin(auth.uid()));

CREATE POLICY "memberships_select_self_or_tenant" ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.is_super_admin(auth.uid()));
CREATE POLICY "memberships_insert_owner_or_bootstrap" ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (
    -- bootstrap: a user creating a tenant grants themselves owner
    (user_id = auth.uid() AND role = 'owner' AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.created_by = auth.uid()))
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.is_super_admin(auth.uid())
  );
CREATE POLICY "memberships_update_owner" ON public.memberships FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.is_super_admin(auth.uid()));
CREATE POLICY "memberships_delete_owner" ON public.memberships FOR DELETE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.is_super_admin(auth.uid()));

CREATE POLICY "stores_select_member" ON public.stores FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "stores_cud_owner_manager" ON public.stores FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'));

CREATE POLICY "audit_select_owner" ON public.audit_logs FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'));
CREATE POLICY "audit_insert_member" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id)));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
