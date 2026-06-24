import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { Boxes, Wallet, HandCoins, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";
import { LocaleSwitcher } from "@/components/locale-switcher";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alpha ERP — L'ERP des commerces d'Afrique de l'Ouest" },
      { name: "description", content: "Stock, ventes, crédits, caisse : un seul logiciel cloud pour piloter votre commerce. Essai 14 jours sans carte bancaire." },
      { property: "og:title", content: "Alpha ERP — Cloud ERP pour commerces" },
      { property: "og:description", content: "Stock, ventes, crédits, caisse : pilotez votre commerce en temps réel." },
    ],
  }),
  component: Index,
});

function Index() {
  const t = useT();
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[image:var(--gradient-hero)] text-primary-foreground font-bold">α</div>
            <span className="font-display text-lg font-semibold tracking-tight">{t("app.name")}</span>
          </Link>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <Link to="/auth"><Button variant="ghost" size="sm">{t("home.login")}</Button></Link>
            <Link to="/auth" search={{ mode: "signup" }}><Button size="sm" className="gap-1.5">{t("home.cta")}<ArrowRight className="h-4 w-4" /></Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,oklch(0.36_0.13_260/0.08),transparent_60%)]" />
        <div className="container mx-auto px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>Conçu à Bamako · Pour l'Afrique de l'Ouest</span>
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {t("home.heroTitle")}
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">{t("home.heroSub")}</p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link to="/auth" search={{ mode: "signup" }}>
                <Button size="lg" className="h-12 gap-2 px-6 text-base">
                  {t("home.cta")} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="outline" className="h-12 px-6 text-base">{t("home.login")}</Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">14 jours gratuits · Sans carte bancaire · Annulation à tout moment</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border bg-card/30">
        <div className="container mx-auto grid gap-8 px-6 py-20 md:grid-cols-3">
          {[
            { icon: Boxes, title: t("home.feature1"), desc: t("home.feature1Desc") },
            { icon: Wallet, title: t("home.feature2"), desc: t("home.feature2Desc") },
            { icon: HandCoins, title: t("home.feature3"), desc: t("home.feature3Desc") },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-accent/15 text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>Données hébergées en sécurité · RLS multi-tenant</span>
          </div>
          <span>© {new Date().getFullYear()} Alpha ERP</span>
        </div>
      </footer>
    </div>
  );
}
