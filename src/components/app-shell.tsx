import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LogOut, ChevronDown, Building2 } from "lucide-react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useMemberships, useActiveTenant, type AppRole } from "@/hooks/use-tenant";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export function AppShell({ children }: { children: (ctx: { tenantId: string; role: AppRole; currency: string }) => ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = useT();
  const { data: memberships, isLoading } = useMemberships(user?.id);
  const { active, switchTenant } = useActiveTenant(memberships);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (!memberships || memberships.length === 0) {
    navigate({ to: "/onboarding" });
    return null;
  }

  if (!active) return null;

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar tenantName={active.tenant.name} role={active.role} />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="hidden items-center gap-2 md:flex">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {memberships.length > 1 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
                        <span className="text-sm font-medium">{active.tenant.name}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-60">
                      <DropdownMenuLabel>Mes entreprises</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {memberships.map((m) => (
                        <DropdownMenuItem key={m.id} onClick={() => switchTenant(m.tenant_id)}>
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate">{m.tenant.name}</span>
                            <Badge variant="outline" className="text-[10px]">{t(`role.${m.role}` as any)}</Badge>
                          </div>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate({ to: "/onboarding" })}>
                        + Nouvelle entreprise
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="text-sm font-medium">{active.tenant.name}</span>
                )}
                <Badge variant="secondary" className="bg-accent/15 text-accent border-accent/20 text-[10px]">{t(`role.${active.role}` as any)}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LocaleSwitcher compact />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 px-1.5">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-sm font-medium">{user?.user_metadata?.full_name ?? user?.email}</div>
                    <div className="text-xs text-muted-foreground">{user?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("auth.signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {children({ tenantId: active.tenant.id, role: active.role, currency: active.tenant.currency })}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}