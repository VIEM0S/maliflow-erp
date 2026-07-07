import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/lib/i18n";
import { slugify } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createTenant } from "@/lib/tenants.functions";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: OnboardingPage,
});

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  rccm: z.string().trim().max(60).optional().or(z.literal("")),
  nif: z.string().trim().max(60).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  country: z.string().min(2).max(2),
  currency: z.string().min(3).max(3),
});

function OnboardingPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const createTenantFn = useServerFn(createTenant);
  const [form, setForm] = useState({
    name: "",
    city: "Bamako",
    phone: "",
    rccm: "",
    nif: "",
    address: "",
    country: "ML",
    currency: "XOF",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Formulaire invalide");
      return;
    }
    setLoading(true);
    try {
      // Vérifie la session avant l'appel serveur pour un message clair.
      const { data: authData } = await supabase.auth.getSession();
      if (!authData.session) {
        toast.error("Session expirée. Veuillez vous reconnecter.");
        navigate({ to: "/auth" });
        return;
      }
      const slug = `${slugify(form.name)}-${Math.random().toString(36).slice(2, 6)}`;
      const tenant = await createTenantFn({
        data: {
          name: form.name.trim(),
          slug,
          city: form.city || null,
          phone: form.phone || null,
          rccm: form.rccm || null,
          nif: form.nif || null,
          address: form.address || null,
          country: form.country,
          currency: form.currency,
        },
      });
      if (typeof window !== "undefined") window.localStorage.setItem("alpha_active_tenant", tenant.id);
      await qc.invalidateQueries({ queryKey: ["memberships"] });
      toast.success("Entreprise créée");
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err?.message ?? "Erreur lors de la création");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="container mx-auto flex h-14 items-center gap-2 px-6">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-[image:var(--gradient-hero)] text-primary-foreground font-bold text-sm">α</div>
          <span className="font-semibold">Alpha ERP</span>
        </div>
      </header>
      <main className="container mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent/15 text-accent">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-semibold">{t("onboarding.title")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("onboarding.sub")}</p>
        </div>

        <Card className="border-border p-6 shadow-[var(--shadow-card)]">
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("onboarding.companyName")} *</Label>
              <Input id="name" required value={form.name} onChange={set("name")} placeholder={t("onboarding.companyNamePh")} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rccm">{t("onboarding.rccm")}</Label>
                <Input id="rccm" value={form.rccm} onChange={set("rccm")} placeholder="MA-BKO-2024-A-123" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nif">{t("onboarding.nif")}</Label>
                <Input id="nif" value={form.nif} onChange={set("nif")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="city">{t("onboarding.city")}</Label>
                <Input id="city" value={form.city} onChange={set("city")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("onboarding.phone")}</Label>
                <Input id="phone" value={form.phone} onChange={set("phone")} placeholder="+223 ..." />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">{t("onboarding.address")}</Label>
              <Input id="address" value={form.address} onChange={set("address")} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="country">{t("onboarding.country")}</Label>
                <Input id="country" maxLength={2} value={form.country} onChange={set("country")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">{t("onboarding.currency")}</Label>
                <Input id="currency" maxLength={3} value={form.currency} onChange={set("currency")} />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("onboarding.create")}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}