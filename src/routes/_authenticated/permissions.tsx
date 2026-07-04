import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Save, AlertTriangle, Eye, Check, X as XIcon, User, Bookmark, Trash2, Plus, Download, History, Search, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { listPresetAudit, getPresetAuditDetail } from "@/lib/audit.functions";

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
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
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
  preset_name: string | null;
  created_at: string;
};

type AuditDetail = {
  id: string;
  ip_address: string | null;
  metadata: {
    preset_name?: string;
    preset_id?: string;
    before?: Partial<Record<InventoryPermission, AppRole[]>> | null;
    after?: Partial<Record<InventoryPermission, AppRole[]>> | null;
    changed?: InventoryPermission[];
  } | null;
};

type PresetAuditAction = "create" | "update" | "delete" | "apply";

const db = supabase as unknown as { from: (t: string) => any };

let cachedIp: string | null | undefined;
async function getClientIp(): Promise<string | null> {
  if (cachedIp !== undefined) return cachedIp;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const j = (await res.json()) as { ip?: string };
    cachedIp = j.ip ?? null;
  } catch {
    cachedIp = null;
  }
  return cachedIp;
}

function diffMatrix(
  before: Partial<Record<InventoryPermission, AppRole[]>> | null | undefined,
  after: Partial<Record<InventoryPermission, AppRole[]>> | null | undefined,
): InventoryPermission[] {
  const changed: InventoryPermission[] = [];
  for (const p of PERMISSIONS) {
    const a = new Set((before?.[p] ?? []) as AppRole[]);
    const b = new Set((after?.[p] ?? []) as AppRole[]);
    let same = a.size === b.size;
    if (same) for (const v of a) if (!b.has(v)) { same = false; break; }
    if (!same) changed.push(p);
  }
  return changed;
}

function PermissionsPage({ tenantId, role }: { tenantId: string; role: AppRole }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = role === "owner" || role === "super_admin";
  const canSeeAudit = role === "owner" || role === "super_admin";

  const logPresetAction = async (
    action: PresetAuditAction,
    preset: { id: string; name: string },
    snapshots?: {
      before?: Partial<Record<InventoryPermission, AppRole[]>> | null;
      after?: Partial<Record<InventoryPermission, AppRole[]>> | null;
    },
  ) => {
    if (!user?.id) return;
    const before = snapshots?.before ?? null;
    const after = snapshots?.after ?? null;
    const changed = diffMatrix(before, after);
    const ip = await getClientIp();
    await db.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: user.id,
      action: `preset.${action}`,
      entity: "inventory_permission_preset",
      entity_id: preset.id,
      metadata: { preset_name: preset.name, preset_id: preset.id, before, after, changed },
      ip_address: ip,
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
    const before = draftToPayload();
    const next = emptyDraft();
    for (const perm of PERMISSIONS) {
      next[perm] = new Set((p.payload?.[perm] ?? []) as AppRole[]);
    }
    setDraft(next);
    toast.success(t("perms.presets.applied"));
    void logPresetAction("apply", { id: p.id, name: p.name }, { before, after: p.payload ?? {} });
    qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
  };

  const [dlgOpen, setDlgOpen] = useState(false);
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");

  const createPresetMut = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not authenticated");
      const payload = draftToPayload();
      const { data: inserted, error } = await db.from("inventory_permission_presets").insert({
        owner_user_id: user.id,
        name: pName.trim(),
        description: pDesc.trim() || null,
        payload,
      }).select("id,name").single();
      if (error) throw error;
      await logPresetAction(
        "create",
        { id: inserted.id as string, name: inserted.name as string },
        { before: null, after: payload },
      );
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
    mutationFn: async (preset: { id: string; name: string; payload: Preset["payload"] }) => {
      const after = draftToPayload();
      const { error } = await db.from("inventory_permission_presets")
        .update({ payload: after })
        .eq("id", preset.id);
      if (error) throw error;
      await logPresetAction("update", preset, { before: preset.payload ?? {}, after });
    },
    onSuccess: () => {
      toast.success(t("perms.presets.updated"));
      qc.invalidateQueries({ queryKey: ["inventory-permission-presets", user?.id] });
      qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const deletePresetMut = useMutation({
    mutationFn: async (preset: { id: string; name: string; payload: Preset["payload"] }) => {
      const { error } = await db.from("inventory_permission_presets").delete().eq("id", preset.id);
      if (error) throw error;
      await logPresetAction("delete", preset, { before: preset.payload ?? {}, after: null });
    },
    onSuccess: () => {
      toast.success(t("perms.presets.deleted"));
      qc.invalidateQueries({ queryKey: ["inventory-permission-presets", user?.id] });
      qc.invalidateQueries({ queryKey: ["preset-audit", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  type SortKey = "created_at" | "action";
  const [auditPage, setAuditPage] = useState(0);
  const [auditPageSize, setAuditPageSize] = useState<number>(25);
  const [auditSortBy, setAuditSortBy] = useState<SortKey>("created_at");
  const [auditSortDir, setAuditSortDir] = useState<"asc" | "desc">("desc");
  const [auditSearchInput, setAuditSearchInput] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState<
    "all" | "create" | "update" | "delete" | "apply"
  >("all");
  useEffect(() => {
    const h = setTimeout(() => {
      setAuditSearch(auditSearchInput.trim());
      setAuditPage(0);
    }, 300);
    return () => clearTimeout(h);
  }, [auditSearchInput]);
  const callList = useServerFn(listPresetAudit);
  const callDetail = useServerFn(getPresetAuditDetail);

  const auditQ = useQuery({
    queryKey: [
      "preset-audit",
      tenantId,
      auditPage,
      auditPageSize,
      auditSortBy,
      auditSortDir,
      auditSearch,
      auditActionFilter,
    ],
    enabled: canSeeAudit && !!tenantId,
    placeholderData: (prev) => prev,
    retry: false,
    queryFn: async (): Promise<{ rows: AuditRow[]; total: number }> => {
      const res = await callList({
        data: {
          tenantId,
          page: auditPage,
          pageSize: auditPageSize,
          sortBy: auditSortBy,
          sortDir: auditSortDir,
          search: auditSearch || undefined,
          actionFilter: auditActionFilter,
        },
      });
      return { rows: (res.rows ?? []) as AuditRow[], total: res.total ?? 0 };
    },
  });

  const auditRows = auditQ.data?.rows ?? [];
  const auditTotal = auditQ.data?.total ?? 0;
  const auditPageCount = Math.max(1, Math.ceil(auditTotal / auditPageSize));
  useEffect(() => {
    if (auditPage > 0 && auditPage >= auditPageCount) setAuditPage(auditPageCount - 1);
  }, [auditPage, auditPageCount]);

  const toggleSort = (key: SortKey) => {
    if (auditSortBy === key) {
      setAuditSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setAuditSortBy(key);
      setAuditSortDir("desc");
    }
    setAuditPage(0);
  };
  const sortIcon = (key: SortKey) =>
    auditSortBy === key
      ? (auditSortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
      : null;

  const [selectedAudit, setSelectedAudit] = useState<AuditRow | null>(null);

  const auditDetailQ = useQuery({
    queryKey: ["preset-audit-detail", selectedAudit?.id],
    enabled: !!selectedAudit?.id,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<AuditDetail | null> => {
      const row = await callDetail({ data: { tenantId, id: selectedAudit!.id } });
      return (row ?? null) as AuditDetail | null;
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
                        onClick={() => updatePresetMut.mutate({ id: p.id, name: p.name, payload: p.payload })}
                        disabled={updatePresetMut.isPending}
                      >
                        <Save className="h-3 w-3" /> {t("perms.presets.update")}
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 gap-1 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(t("perms.presets.confirmDelete"))) deletePresetMut.mutate({ id: p.id, name: p.name, payload: p.payload });
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

      {!canSeeAudit ? (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 text-destructive" />
          <div>
            <div className="font-medium text-destructive">{t("perms.audit.deniedTitle")}</div>
            <p className="text-xs text-muted-foreground">{t("perms.audit.deniedBody")}</p>
          </div>
        </Card>
      ) : (
        <Card className="p-4 space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <History className="h-4 w-4 text-primary" /> {t("perms.audit.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("perms.audit.sub")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={auditSearchInput}
                onChange={(e) => setAuditSearchInput(e.target.value)}
                placeholder={t("perms.audit.searchPlaceholder")}
                className="h-8 w-56 pl-7 text-xs"
                aria-label={t("perms.audit.search")}
              />
            </div>
            <Select
              value={auditActionFilter}
              onValueChange={(v) => { setAuditActionFilter(v as typeof auditActionFilter); setAuditPage(0); }}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={t("perms.audit.actionFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("perms.audit.actionAll")}</SelectItem>
                <SelectItem value="create">{t("perms.audit.action.create")}</SelectItem>
                <SelectItem value="update">{t("perms.audit.action.update")}</SelectItem>
                <SelectItem value="delete">{t("perms.audit.action.delete")}</SelectItem>
                <SelectItem value="apply">{t("perms.audit.action.apply")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {auditQ.error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <Lock className="mt-0.5 h-3.5 w-3.5" />
              <div>
                <div className="font-medium">{t("perms.audit.deniedTitle")}</div>
                <div className="text-muted-foreground">{(auditQ.error as Error).message}</div>
              </div>
            </div>
          ) : auditQ.isLoading && !auditQ.data ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : auditTotal === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t("perms.audit.empty")}</p>
          ) : (
            <>
              <div className="overflow-hidden rounded-md border">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">
                      <button
                        type="button"
                        onClick={() => toggleSort("created_at")}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        aria-label={auditSortDir === "asc" ? t("perms.audit.sortAsc") : t("perms.audit.sortDesc")}
                      >
                        {t("perms.audit.when")} {sortIcon("created_at")}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("action")}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {t("perms.audit.what")} {sortIcon("action")}
                      </button>
                    </TableHead>
                    <TableHead>{t("perms.audit.preset")}</TableHead>
                    <TableHead className="text-right">{t("perms.audit.who")}</TableHead>
                    <TableHead className="w-[60px] text-right">{t("perms.audit.view")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditRows.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelectedAudit(row)}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(row.action)}>{actionLabel(row.action)}</Badge>
                      </TableCell>
                      <TableCell className="truncate">
                        {row.preset_name ?? row.entity_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                        {row.user_id ? row.user_id.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => { e.stopPropagation(); setSelectedAudit(row); }}
                          aria-label={t("perms.audit.view")}
                        >
                          <Search className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{t("perms.audit.rows")}</span>
                  <Select
                    value={String(auditPageSize)}
                    onValueChange={(v) => { setAuditPageSize(Number(v)); setAuditPage(0); }}
                  >
                    <SelectTrigger className="h-7 w-[70px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50, 100].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>· {auditTotal} {t("perms.audit.total")}</span>
                  {auditQ.isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                <div className="flex items-center gap-2">
                  <span>
                    {t("perms.audit.page")} {auditPage + 1} {t("perms.audit.of")} {auditPageCount}
                  </span>
                  <Button
                    size="sm" variant="outline" className="h-7 gap-1"
                    onClick={() => setAuditPage((p) => Math.max(0, p - 1))}
                    disabled={auditPage === 0}
                  >
                    <ChevronLeft className="h-3 w-3" /> {t("perms.audit.prev")}
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-7 gap-1"
                    onClick={() => setAuditPage((p) => Math.min(auditPageCount - 1, p + 1))}
                    disabled={auditPage + 1 >= auditPageCount}
                  >
                    {t("perms.audit.next")} <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      <Sheet open={!!selectedAudit} onOpenChange={(o) => !o && setSelectedAudit(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedAudit && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  {t("perms.audit.details")}
                  <Badge variant={actionVariant(selectedAudit.action)}>{actionLabel(selectedAudit.action)}</Badge>
                </SheetTitle>
                <SheetDescription>{t("perms.audit.detailsSub")}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-2">
                    <div className="text-[11px] uppercase text-muted-foreground">{t("perms.audit.timestamp")}</div>
                    <div className="font-mono text-xs">{new Date(selectedAudit.created_at).toLocaleString()}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[11px] uppercase text-muted-foreground">{t("perms.audit.ip")}</div>
                    <div className="font-mono text-xs">
                      {auditDetailQ.isLoading
                        ? <Loader2 className="inline h-3 w-3 animate-spin" />
                        : (auditDetailQ.data?.ip_address ?? "—")}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[11px] uppercase text-muted-foreground">{t("perms.audit.user")}</div>
                    <div className="font-mono text-xs truncate">{selectedAudit.user_id ?? "—"}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[11px] uppercase text-muted-foreground">{t("perms.audit.preset")}</div>
                    <div className="truncate text-xs">{selectedAudit.preset_name ?? selectedAudit.entity_id ?? "—"}</div>
                  </div>
                </div>

                {auditDetailQ.isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t("common.loading")}
                  </div>
                ) : (
                  <AuditDiff
                    before={auditDetailQ.data?.metadata?.before ?? null}
                    after={auditDetailQ.data?.metadata?.after ?? null}
                    changedHint={auditDetailQ.data?.metadata?.changed ?? null}
                    t={t}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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

function RoleList({
  roles,
  highlight,
  emptyLabel,
}: {
  roles: AppRole[];
  highlight?: { added?: Set<AppRole>; removed?: Set<AppRole> };
  emptyLabel: string;
}) {
  if (roles.length === 0) {
    return <span className="text-[11px] italic text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => {
        const added = highlight?.added?.has(r);
        const removed = highlight?.removed?.has(r);
        const cls = added
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : removed
            ? "border-rose-500/50 bg-rose-500/10 text-rose-700 line-through dark:text-rose-300"
            : "";
        return (
          <Badge key={r} variant="outline" className={`text-[10px] ${cls}`}>
            {r}
          </Badge>
        );
      })}
    </span>
  );
}

function AuditDiff({
  before,
  after,
  changedHint,
  t,
}: {
  before: Partial<Record<InventoryPermission, AppRole[]>> | null;
  after: Partial<Record<InventoryPermission, AppRole[]>> | null;
  changedHint: InventoryPermission[] | null;
  t: (k: never) => string;
}) {
  const hasData = !!before || !!after;
  if (!hasData) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs italic text-muted-foreground">
        {t("perms.audit.noData" as never)}
      </div>
    );
  }
  // Recompute diff to be safe, even if hint is missing.
  const changed = (changedHint && changedHint.length > 0
    ? changedHint
    : diffMatrix(before, after)) as InventoryPermission[];

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">
        {t("perms.audit.diffTitle" as never)}
      </div>
      {changed.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">{t("perms.audit.noChange" as never)}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {changed.map((p) => {
            const beforeRoles = ((before?.[p] ?? []) as AppRole[]);
            const afterRoles = ((after?.[p] ?? []) as AppRole[]);
            const beforeSet = new Set(beforeRoles);
            const afterSet = new Set(afterRoles);
            const added = new Set(afterRoles.filter((r) => !beforeSet.has(r)));
            const removed = new Set(beforeRoles.filter((r) => !afterSet.has(r)));
            return (
              <li key={p} className="grid gap-2 p-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
                <div className="md:col-span-3 text-xs font-medium">
                  {t(`perms.perm.${p}` as never)}
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">{p}</span>
                </div>
                <div className="rounded border bg-muted/30 p-1.5">
                  <div className="mb-1 text-[10px] uppercase text-muted-foreground">
                    {t("perms.audit.before" as never)}
                  </div>
                  <RoleList
                    roles={beforeRoles}
                    highlight={{ removed }}
                    emptyLabel={t("perms.audit.empty.roles" as never)}
                  />
                </div>
                <div className="hidden text-muted-foreground md:block">→</div>
                <div className="rounded border bg-muted/30 p-1.5">
                  <div className="mb-1 text-[10px] uppercase text-muted-foreground">
                    {t("perms.audit.after" as never)}
                  </div>
                  <RoleList
                    roles={afterRoles}
                    highlight={{ added }}
                    emptyLabel={t("perms.audit.empty.roles" as never)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}