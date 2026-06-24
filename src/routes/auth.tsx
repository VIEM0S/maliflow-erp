import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";

const searchSchema = z.object({ mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Connexion — Alpha ERP" },
      { name: "description", content: "Accédez à votre espace Alpha ERP." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode = "signin" } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const t = useT();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => setIsSignup(mode === "signup"), [mode]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Compte créé. Vérifiez votre email si la confirmation est requise.");
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur d'authentification");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/auth",
      });
      if (result.error) {
        toast.error(result.error.message || "Échec de connexion Google");
      } else if (!result.redirected) {
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur Google");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden flex-col justify-between bg-[image:var(--gradient-hero)] p-12 text-primary-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-foreground font-bold">α</div>
          <span className="font-display text-xl font-semibold">Alpha ERP</span>
        </Link>
        <div>
          <h2 className="font-display text-3xl font-semibold leading-tight">
            "Plus de cahier, plus de vol.<br />Mon stock est juste, ma caisse aussi."
          </h2>
          <p className="mt-4 text-sm text-primary-foreground/70">— Pilote quincaillerie · Bamako, Sogoniko</p>
        </div>
        <div className="text-xs text-primary-foreground/60">
          Hébergement sécurisé · Isolation multi-tenant · Audit logs
        </div>
      </div>

      {/* Right form */}
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Accueil
          </Link>
          <LocaleSwitcher compact />
        </header>
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <Card className="w-full max-w-md border-border bg-card p-8 shadow-[var(--shadow-card)]">
            <h1 className="font-display text-2xl font-semibold">
              {isSignup ? t("auth.signUpTitle") : t("auth.signInTitle")}
            </h1>
            {isSignup && <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.signUpSub")}</p>}

            <Button
              type="button"
              variant="outline"
              className="mt-6 w-full justify-center gap-2"
              onClick={handleGoogle}
              disabled={googleLoading}
            >
              {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              {t("auth.continueGoogle")}
            </Button>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
              <Separator className="flex-1" /> {t("auth.or")} <Separator className="flex-1" />
            </div>

            <form onSubmit={handleEmail} className="space-y-4">
              {isSignup && (
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">{t("auth.fullName")}</Label>
                  <Input id="full_name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSignup ? t("auth.signUp") : t("auth.signIn")}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {isSignup ? t("auth.hasAccount") : t("auth.noAccount")}{" "}
              <button
                type="button"
                onClick={() => setIsSignup(!isSignup)}
                className="font-medium text-primary hover:underline"
              >
                {isSignup ? t("auth.signIn") : t("auth.signUp")}
              </button>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6 0-1.1-.1-1.6H12z" />
    </svg>
  );
}
