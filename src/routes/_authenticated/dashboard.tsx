import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, AlertTriangle, Package, ArrowUpRight } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord — Alpha ERP" }] }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return <AppShell>{(ctx) => <Dashboard {...ctx} />}</AppShell>;
}

function Dashboard({ currency, role }: { tenantId: string; role: string; currency: string }) {
  const t = useT();
  const { user } = useAuth();
  const name = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "";
  const seeMargin = role === "owner" || role === "super_admin";

  // Demo data — to be replaced by real queries module by module
  const revenue7d = [
    { d: "Lun", v: 245000 }, { d: "Mar", v: 312000 }, { d: "Mer", v: 198000 },
    { d: "Jeu", v: 415000 }, { d: "Ven", v: 528000 }, { d: "Sam", v: 690000 }, { d: "Dim", v: 175000 },
  ];
  const topProducts = [
    { name: "Ciment 50kg", qty: 142, rev: 1136000 },
    { name: "Fer à béton 12mm", qty: 89, rev: 712000 },
    { name: "Tôle bac 2m", qty: 64, rev: 480000 },
    { name: "Peinture blanche 20L", qty: 38, rev: 380000 },
    { name: "Clous 5kg", qty: 117, rev: 117000 },
  ];
  const lowStock = [
    { name: "Ciment 50kg", stock: 8, threshold: 30 },
    { name: "Vis 6x80", stock: 0, threshold: 50 },
    { name: "Tuyau PVC 4m", stock: 5, threshold: 20 },
  ];

  return (
    <div className="container mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t("dashboard.welcome")}, {name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-foreground">
          {t("dashboard.demoBadge")}
        </Badge>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("dashboard.salesToday")} value={formatCurrency(528000, currency)} delta="+12.4%" up />
        {seeMargin && <Kpi label={t("dashboard.grossMargin")} value={formatCurrency(842000, currency)} delta="+5.1%" up />}
        {!seeMargin && <Kpi label="Tickets" value={formatNumber(47)} delta="+8" up />}
        <Kpi label={t("dashboard.stockValue")} value={formatCurrency(12480000, currency)} delta="-1.2%" />
        <Kpi label={t("dashboard.overdueCredits")} value={formatCurrency(345000, currency)} delta="3 clients" tone="danger" />
      </div>

      {/* Chart + cash */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">{t("dashboard.revenue7d")}</h2>
              <p className="text-xs text-muted-foreground">{formatCurrency(2563000, currency)} cumul</p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              {t("dashboard.viewAll")} <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenue7d} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="d" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(n) => `${(n / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [formatCurrency(v, currency), "Revenus"]}
                />
                <Area type="monotone" dataKey="v" stroke="var(--color-primary)" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 shadow-[var(--shadow-card)]">
          <h2 className="font-display text-base font-semibold">{t("dashboard.cashRegister")}</h2>
          <p className="text-xs text-muted-foreground">Caisse principale</p>
          <div className="mt-5 space-y-3">
            <CashRow label={t("dashboard.theoretical")} value={formatCurrency(528000, currency)} />
            <CashRow label={t("dashboard.actual")} value={formatCurrency(525500, currency)} />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm font-medium">{t("dashboard.variance")}</span>
              <span className="font-display text-base font-semibold text-destructive">-{formatCurrency(2500, currency)}</span>
            </div>
            <Button variant="outline" size="sm" className="mt-2 w-full">Clôturer la caisse</Button>
          </div>
        </Card>
      </div>

      {/* Top products + low stock */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-4 font-display text-base font-semibold">{t("dashboard.topProducts")}</h2>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Produit</th>
                  <th className="px-3 py-2 text-right font-medium">Qté</th>
                  <th className="px-3 py-2 text-right font-medium">CA</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={p.name} className={i > 0 ? "border-t border-border" : ""}>
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.qty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(p.rev, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="font-display text-base font-semibold">{t("dashboard.lowStock")}</h2>
          </div>
          <ul className="space-y-3">
            {lowStock.map((p) => (
              <li key={p.name} className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-background/60 p-3">
                <div className="flex items-start gap-2.5">
                  <Package className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">Seuil : {p.threshold}</p>
                  </div>
                </div>
                <Badge variant={p.stock === 0 ? "destructive" : "outline"} className={p.stock === 0 ? "" : "border-warning/40 bg-warning/10 text-warning-foreground"}>
                  {p.stock === 0 ? "Rupture" : `${p.stock} restant`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, up, tone }: { label: string; value: string; delta?: string; up?: boolean; tone?: "danger" }) {
  const deltaColor = tone === "danger" ? "text-destructive" : up ? "text-success" : "text-muted-foreground";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Card className="p-5 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</p>
      {delta && (
        <div className={`mt-1.5 flex items-center gap-1 text-xs ${deltaColor}`}>
          {tone !== "danger" && <Icon className="h-3.5 w-3.5" />}
          <span>{delta}</span>
        </div>
      )}
    </Card>
  );
}

function CashRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}