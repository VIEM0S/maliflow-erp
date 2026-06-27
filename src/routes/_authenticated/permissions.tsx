import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Save, AlertTriangle, Eye, Check, X as XIcon, User } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import type { AppRole } from "@/hooks/use-tenant";

export const Route = createFileRoute("/_authenticated/permissions")({
  head: () => ({ meta: [{ title: "Permissions — Alpha ERP" }] }),
  component: () => <AppShell>{(ctx) => <PermissionsPage {...ctx} />}</AppShell>,
});

type InventoryPermission = "create" | "start" | "close" | "cancel" | "adjust_item";
const PERMISSIONS: InventoryPermission[] = ["create", "start", "close", "cancel", "adjust_item"];
const ROLES: Exclude<AppRole, "owner" | "super_admin">[] = ["manager", "cashier"];
const SIM_ROLES: AppRole[] = ["owner", "manager", "cashier"];

type Row = { id: string; tenant_id: string; permission: InventoryPermission; allowed_roles: AppRole[] };

const db = supabase as unknown as { from: (t: string) => any };

function PermissionsPage({ tenantId, role }: { tenantId: string; role: AppRole }) {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = role === "owner" || role === "super_admin";

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-inventory-permissions", tenantId],
    queryFn: async () => {
      const { data, error } = await db.from("tenant_inventory_permissions")
        .select("*")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const [draft, setDraft] = useState<Record<InventoryPermission, Set<AppRole>>>(() => emptyDraft());
  const [simRole, setSimRole] = useState<AppRole>("manager");

  useEffect(() => {
    if (!data) return;
    const next = emptyDraft();
    for (const r of data) next[r.permission] = new Set(r.allowed_roles ?? []);
    setDraft(next);
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    for (const r of data) {
      const cur = draft[r.permission] ?? new Set<AppRole>();
      const base = new Set(r.allowed_roles ?? []);
      if (cur.size !== base.size) return true;
      for (const v of cur) if (!base.has(v)) return true;
    }
    return false;
  }, [data, draft]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!data) return;
      // Upsert one row per permission
      const payload = PERMISSIONS.map((perm) => {
        const row = data.find((r) => r.permission === perm);
        const roles = Array.from(draft[perm] ?? new Set<AppRole>());
        return row
          ? { id: row.id, tenant_id: tenantId, permission: perm, allowed_roles: roles }
          : { tenant_id: tenantId, permission: perm, allowed_roles: roles };
      });
      const { error } = await db.from("tenant_inventory_permissions")
        .upsert(payload, { onConflict: "tenant_id,permission" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("perms.saved"));
      qc.invalidateQueries({ queryKey: ["tenant-inventory-permissions", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const toggle = (perm: InventoryPermission, r: AppRole, on: boolean) => {
    setDraft((d) => {
      const next = { ...d };
      const s = new Set(next[perm]);
      if (on) s.add(r); else s.delete(r);
      next[perm] = s;
      return next;
    });
  };

  const simAllows = (perm: InventoryPermission): boolean => {
    if (simRole === "super_admin" || simRole === "owner") return true;
    return draft[perm]?.has(simRole) ?? false;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" />
            {t("perms.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("perms.sub")}</p>
        </div>
        {canEdit && (
          <Button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending} className="gap-2">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("common.save")}
          </Button>
        )}
      </div>

      {!canEdit && (
        <Card className="flex items-center gap-2 border-amber-300/40 bg-amber-50/40 p-4 text-sm text-amber-900 dark:bg-amber-900/10 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" /> {t("perms.ownerOnly")}
        </Card>
      )}

      <Card className="p-4 text-sm text-muted-foreground space-y-1">
        <p>• {t("perms.ownerNote")}</p>
        <p>• {t("perms.cashierNote")}</p>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Eye className="h-4 w-4 text-primary" /> {t("perms.sim.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("perms.sim.sub")}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {dirty ? t("perms.sim.dirtyHint") : t("perms.sim.savedHint")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("perms.sim.role")}</span>
            <Select value={simRole} onValueChange={(v) => setSimRole(v as AppRole)}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIM_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r === "owner" ? t("role.owner") : t(`perms.role.${r}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PERMISSIONS.map((perm) => {
            const ok = simAllows(perm);
            return (
              <div
                key={perm}
                className={`flex items-center justify-between rounded-md border p-2.5 text-sm ${
                  ok
                    ? "border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-900/10"
                    : "border-border bg-muted/30 opacity-70"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{t(`perms.perm.${perm}` as never)}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{perm}</div>
                </div>
                {ok ? (
                  <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                    <Check className="h-3 w-3" /> {t("perms.sim.allowed")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <XIcon className="h-3 w-3" /> {t("perms.sim.denied")}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[55%]">{t("perms.permission")}</TableHead>
                {ROLES.map((r) => (
                  <TableHead key={r} className="text-center">{t(`perms.role.${r}` as never)}</TableHead>
                ))}
                <TableHead className="text-right">{t("role.owner")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map((perm) => (
                <TableRow key={perm}>
                  <TableCell>
                    <div className="font-medium">{t(`perms.perm.${perm}` as never)}</div>
                    <div className="text-xs text-muted-foreground font-mono">{perm}</div>
                  </TableCell>
                  {ROLES.map((r) => {
                    const checked = draft[perm]?.has(r) ?? false;
                    return (
                      <TableCell key={r} className="text-center">
                        <Switch
                          checked={checked}
                          disabled={!canEdit}
                          onCheckedChange={(v) => toggle(perm, r, v)}
                          aria-label={`${perm}-${r}`}
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right">
                    <Badge variant="default">✓</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function emptyDraft(): Record<InventoryPermission, Set<AppRole>> {
  return {
    create: new Set<AppRole>(),
    start: new Set<AppRole>(),
    close: new Set<AppRole>(),
    cancel: new Set<AppRole>(),
    adjust_item: new Set<AppRole>(),
  };
}