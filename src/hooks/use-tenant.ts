import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = "super_admin" | "owner" | "manager" | "cashier";

export interface MembershipWithTenant {
  id: string;
  role: AppRole;
  tenant_id: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    logo_url: string | null;
  };
}

const STORAGE_KEY = "alpha_active_tenant";

export function useMemberships(userId: string | undefined) {
  return useQuery({
    queryKey: ["memberships", userId],
    enabled: !!userId,
    queryFn: async (): Promise<MembershipWithTenant[]> => {
      const { data, error } = await supabase
        .from("memberships")
        .select("id, role, tenant_id, tenant:tenants ( id, name, slug, currency, logo_url )")
        .eq("user_id", userId!)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as unknown as MembershipWithTenant[];
    },
  });
}

export function useActiveTenant(memberships: MembershipWithTenant[] | undefined) {
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  useEffect(() => {
    if (!memberships || memberships.length === 0) return;
    if (!activeId || !memberships.find((m) => m.tenant_id === activeId)) {
      const first = memberships[0].tenant_id;
      setActiveId(first);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, first);
    }
  }, [memberships, activeId]);

  const active = memberships?.find((m) => m.tenant_id === activeId) ?? memberships?.[0] ?? null;

  const switchTenant = (id: string) => {
    setActiveId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  return { active, switchTenant };
}

export type DB = Database;