import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Save, AlertTriangle, Eye, Check, X as XIcon, User, Bookmark, Trash2, Plus, Download, History } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import type { AppRole } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/permissions")({
  head: () => ({ meta: [{ title: "Permissions — Alpha ERP" }] }),
  component: () => <AppShell>{(ctx) => <PermissionsPage {...ctx} />}</AppShell>,
});

type InventoryPermission = "create" | "start" | "close" | "cancel" | "adjust_item";
const PERMISSIONS: InventoryPermission[] = ["create", "start", "close", "cancel", "adjust_item"];
const ROLES: Exclude<AppRole, "owner" | "super_admin">[] = ["manager", "cashier"];
const SIM_ROLES: AppRole[] = ["owner", "manager", "cashier"];

type Row = { id: string; tenant_id: string; permission: InventoryPermission; allowed_roles: AppRole[] };
type Preset = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  payload: Partial<Record<InventoryPermission, AppRole[]>>;
  updated_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  user_id: string | null;
  metadata: { preset_name?: string; preset_id?: string } | null;
  created_at: string;
};

type PresetAuditAction = "create" | "update" | "delete" | "apply";

const db = supabase as unknown as { from: (t: string) => any };

function PermissionsPage({ tenantId, role }: { tenantId: string; role: AppRole }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = role === "owner" || role === "super_admin";
  const canSeeAudit = role === "owner" || role === "super_admin";

  const logPresetAction = async (
    action: PresetAuditAction,
    preset: { id: string; name: string },
  ) => {
    if (!user?.id) return;
    await db.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: user.id,
      action: `preset.${action}`,
      entity: "inventory_permission_preset",
      entity_id: preset.id,
      metadata: { preset_name: preset.name, preset_id: preset.id },
    });
  };

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

  // ----- Presets (cross-tenant, scoped per user) -----
  const presetsQ = useQuery({
    queryKey: ["inventory-permission-presets", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<Preset[]> => {
      const { data, error } = await db.from("inventory_permission_presets")
        .select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Preset[];
    },
  });

  const draftToPayload = (): Record<string, AppRole[]> => {
    const out: Record<string, AppRole[]> = {};
    for (const p of PERMISSIONS) out[p] = Array.from(draft[p] ?? new Set<AppRole>());
    return out;
  };

  const applyPreset = (p: Preset) => {
    const next = emptyDraft();
    for (const perm of PERMISSIONS) {
      next[perm] = new Set((p.payload?.[perm] ?? []) as AppRole[]);
    }
    setDraft(next);
    toast.success(t("perms.presets.applied"));
    void logPresetAction("apply", { id: p.id, name: p.name });
    qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
  };

  const [dlgOpen, setDlgOpen] = useState(false);
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");

  const createPresetMut = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not authenticated");
      const { data: inserted, error } = await db.from("inventory_permission_presets").insert({
        owner_user_id: user.id,
        name: pName.trim(),
        description: pDesc.trim() || null,
        payload: draftToPayload(),
      }).select("id,name").single();
      if (error) throw error;
      await logPresetAction("create", { id: inserted.id as string, name: inserted.name as string });
    },
    onSuccess: () => {
      toast.success(t("perms.presets.saved"));
      setDlgOpen(false); setPName(""); setPDesc("");
      qc.invalidateQueries({ queryKey: ["inventory-permission-presets", user?.id] });
      qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const updatePresetMut = useMutation({
    mutationFn: async (preset: { id: string; name: string }) => {
      const { error } = await db.from("inventory_permission_presets")
        .update({ payload: draftToPayload() })
        .eq("id", preset.id);
      if (error) throw error;
      await logPresetAction("update", preset);
    },
    onSuccess: () => {
      toast.success(t("perms.presets.updated"));
      qc.invalidateQueries({ queryKey: ["inventory-permission-presets", user?.id] });
      qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const deletePresetMut = useMutation({
    mutationFn: async (preset: { id: string; name: string }) => {
      const { error } = await db.from("inventory_permission_presets").delete().eq("id", preset.id);
      if (error) throw error;
      await logPresetAction("delete", preset);
    },
    onSuccess: () => {
      toast.success(t("perms.presets.deleted"));
      qc.invalidateQueries({ queryKey: ["inventory-permission-presets", user?.id] });
      qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const auditQ = useQuery({
    queryKey: ["preset-audit", tenantId],
    enabled: canSeeAudit && !!tenantId,
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await db.from("audit_logs")
        .select("id,action,entity,entity_id,user_id,metadata,created_at")
        .eq("tenant_id", tenantId)
        .eq("entity", "inventory_permission_preset")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const actionLabel = (action: string): string => {
    const key = action.replace(/^preset\./, "") as PresetAuditAction;
    const map: Record<PresetAuditAction, string> = {
      create: t("perms.audit.action.create"),
      update: t("perms.audit.action.update"),
      delete: t("perms.audit.action.delete"),
      apply: t("perms.audit.action.apply"),
    };
    return map[key] ?? action;
  };

  const actionVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    const key = action.replace(/^preset\./, "");
    if (key === "delete") return "destructive";
    if (key === "create") return "default";
    if (key === "apply") return "secondary";
    return "outline";
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
              <Bookmark className="h-4 w-4 text-primary" /> {t("perms.presets.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("perms.presets.sub")}</p>
          </div>
          {canEdit && (
            <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> {t("perms.presets.save")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("perms.presets.save")}</DialogTitle>
                  <DialogDescription>{t("perms.presets.sub")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium">{t("perms.presets.name")}</label>
                    <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Standard quincaillerie" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("perms.presets.description")}</label>
                    <Textarea value={pDesc} onChange={(e) => setPDesc(e.target.value)} rows={2} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDlgOpen(false)}>{t("perms.presets.cancel")}</Button>
                  <Button
                    onClick={() => createPresetMut.mutate()}
                    disabled={!pName.trim() || createPresetMut.isPending}
                    className="gap-2"
                  >
                    {createPresetMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("perms.presets.create")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {presetsQ.isLoading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : (presetsQ.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground italic">{t("perms.presets.empty")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {presetsQ.data!.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  {p.description && (
                    <div className="truncate text-xs text-muted-foreground">{p.description}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {PERMISSIONS.map((perm) => {
                      const roles = (p.payload?.[perm] ?? []) as AppRole[];
                      if (roles.length === 0) return null;
                      return (
                        <Badge key={perm} variant="outline" className="text-[10px]">
                          {perm}: {roles.join(",")}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="sm" variant="secondary" className="h-7 gap-1" onClick={() => applyPreset(p)} disabled={!canEdit}>
                    <Download className="h-3 w-3" /> {t("perms.presets.apply")}
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        size="sm" variant="outline" className="h-7 gap-1"
                        onClick={() => updatePresetMut.mutate({ id: p.id, name: p.name })}
                        disabled={updatePresetMut.isPending}
                      >
                        <Save className="h-3 w-3" /> {t("perms.presets.update")}
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 gap-1 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(t("perms.presets.confirmDelete"))) deletePresetMut.mutate({ id: p.id, name: p.name });
                        }}
                      >
                        <Trash2 className="h-3 w-3" /> {t("perms.presets.delete")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {canSeeAudit && (
        <Card className="p-4 space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <History className="h-4 w-4 text-primary" /> {t("perms.audit.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("perms.audit.sub")}</p>
          </div>
          {auditQ.isLoading ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : (auditQ.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t("perms.audit.empty")}</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">{t("perms.audit.when")}</TableHead>
                    <TableHead>{t("perms.audit.what")}</TableHead>
                    <TableHead>{t("perms.audit.preset")}</TableHead>
                    <TableHead className="text-right">{t("perms.audit.who")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditQ.data!.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(row.action)}>{actionLabel(row.action)}</Badge>
                      </TableCell>
                      <TableCell className="truncate">
                        {row.metadata?.preset_name ?? row.entity_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                        {row.user_id ? row.user_id.slice(0, 8) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

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