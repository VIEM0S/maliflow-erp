import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, Plus, Play, CheckCircle2, XCircle, Trash2,
  ArrowLeft, Search, Loader2, AlertTriangle, FileText, Scale,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import type { AppRole } from "@/hooks/use-tenant";

export const Route = createFileRoute("/_authenticated/inventory-counts")({
  head: () => ({ meta: [{ title: "Inventaires — Alpha ERP" }] }),
  component: () => <AppShell>{(ctx) => <InventoryCountsPage {...ctx} />}</AppShell>,
});

type CountStatus = "draft" | "in_progress" | "closed" | "cancelled";

type InventoryCount = {
  id: string;
  tenant_id: string;
  store_id: string | null;
  reference: string;
  status: CountStatus;
  notes: string | null;
  started_at: string | null;
  closed_at: string | null;
  created_at: string;
};

type CountItem = {
  id: string;
  count_id: string;
  tenant_id: string;
  product_id: string;
  system_qty: number;
  physical_qty: number | null;
  variance: number;
  counted_at: string | null;
  product?: { id: string; name: string; sku: string; unit: string; cost_price: number } | null;
};

const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function statusVariant(s: CountStatus): "default" | "secondary" | "outline" | "destructive" {
  if (s === "closed") return "default";
  if (s === "in_progress") return "secondary";
  if (s === "cancelled") return "destructive";
  return "outline";
}

function InventoryCountsPage({ tenantId, role, currency }: { tenantId: string; role: AppRole; currency: string }) {
  const t = useT();
  const canEdit = role === "owner" || role === "manager" || role === "super_admin";
  const canDelete = role === "owner" || role === "super_admin";
  const qc = useQueryClient();

  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: counts, isLoading } = useQuery({
    queryKey: ["inventory-counts", tenantId],
    queryFn: async () => {
      const { data, error } = await db.from("inventory_counts")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InventoryCount[];
    },
  });

  if (openId) {
    return (
      <CountDetail
        countId={openId}
        tenantId={tenantId}
        currency={currency}
        canEdit={canEdit}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ClipboardList className="h-6 w-6 text-primary" />
            {t("counts.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("counts.sub")}</p>
        </div>
        {canEdit && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> {t("counts.new")}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : !counts || counts.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {t("counts.empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("counts.reference")}</TableHead>
                <TableHead>{t("counts.status")}</TableHead>
                <TableHead>{t("counts.startedAt")}</TableHead>
                <TableHead>{t("counts.closedAt")}</TableHead>
                <TableHead className="text-right">{t("counts.openCount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.reference}
                    {c.notes && <p className="text-xs text-muted-foreground line-clamp-1">{c.notes}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(c.status)}>
                      {t(`counts.status.${c.status}` as never)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.started_at ? new Date(c.started_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.closed_at ? new Date(c.closed_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(c.id)}>
                      {t("counts.openCount")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantId={tenantId}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["inventory-counts", tenantId] });
          setCreateOpen(false);
          setOpenId(id);
        }}
      />
    </div>
  );
}

function CreateDialog({
  open, onOpenChange, tenantId, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; tenantId: string; onCreated: (id: string) => void }) {
  const t = useT();
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reference.trim()) {
      toast.error(t("counts.reference"));
      return;
    }
    setSaving(true);
    const { data, error } = await db.from("inventory_counts")
      .insert({ tenant_id: tenantId, reference: reference.trim(), notes: notes.trim() || null })
      .select("id")
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setReference(""); setNotes("");
    onCreated((data as { id: string }).id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("counts.new")}</DialogTitle>
          <DialogDescription>{t("counts.startSnapshotHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("counts.reference")}</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("counts.referencePh")} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("counts.notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ItemFilter = "all" | "variance" | "pending";

function CountDetail({
  countId, tenantId, currency, canEdit, onBack,
}: { countId: string; tenantId: string; currency: string; canEdit: boolean; onBack: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: count } = useQuery({
    queryKey: ["inventory-count", countId],
    queryFn: async () => {
      const { data, error } = await db.from("inventory_counts").select("*").eq("id", countId).single();
      if (error) throw error;
      return data as InventoryCount;
    },
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["inventory-count-items", countId],
    queryFn: async () => {
      const { data, error } = await db.from("inventory_count_items")
        .select("*, product:products(id,name,sku,unit,cost_price)")
        .eq("count_id", countId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as CountItem[];
    },
    enabled: !!count,
  });

  const isDraft = count?.status === "draft";
  const isInProgress = count?.status === "in_progress";
  const isClosed = count?.status === "closed" || count?.status === "cancelled";

  const startMut = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("start_inventory_count", { _count_id: countId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("counts.start"));
      qc.invalidateQueries({ queryKey: ["inventory-count", countId] });
      qc.invalidateQueries({ queryKey: ["inventory-count-items", countId] });
      qc.invalidateQueries({ queryKey: ["inventory-counts", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("close_inventory_count", { _count_id: countId });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (n: number) => {
      toast.success(t("counts.closeSuccess").replace("{n}", String(n)));
      qc.invalidateQueries({ queryKey: ["inventory-count", countId] });
      qc.invalidateQueries({ queryKey: ["inventory-count-items", countId] });
      qc.invalidateQueries({ queryKey: ["inventory-counts", tenantId] });
      qc.invalidateQueries({ queryKey: ["stock-balances", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("inventory_counts").update({ status: "cancelled" }).eq("id", countId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-count", countId] });
      qc.invalidateQueries({ queryKey: ["inventory-counts", tenantId] });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("inventory_counts").delete().eq("id", countId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-counts", tenantId] });
      onBack();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const updateItem = async (id: string, physical: number | null) => {
    const patch: Record<string, unknown> = {
      physical_qty: physical,
      counted_at: physical === null ? null : new Date().toISOString(),
    };
    const { error } = await db.from("inventory_count_items").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["inventory-count-items", countId] });
  };

  const bulkSet = async (mode: "zero" | "match") => {
    if (!items) return;
    const updates = items.map((it) => ({
      id: it.id,
      physical_qty: mode === "zero" ? 0 : Number(it.system_qty),
    }));
    // Run sequentially in small batches to keep RLS simple
    for (const u of updates) {
      await db.from("inventory_count_items").update({
        physical_qty: u.physical_qty,
        counted_at: new Date().toISOString(),
      }).eq("id", u.id);
    }
    qc.invalidateQueries({ queryKey: ["inventory-count-items", countId] });
  };

  const stats = useMemo(() => {
    const counted = items?.filter((i) => i.physical_qty !== null).length ?? 0;
    const pending = (items?.length ?? 0) - counted;
    const withVariance = items?.filter((i) => i.physical_qty !== null && Number(i.variance) !== 0).length ?? 0;
    const totalValueDelta = items?.reduce((acc, i) => {
      if (i.physical_qty === null) return acc;
      return acc + Number(i.variance) * Number(i.product?.cost_price ?? 0);
    }, 0) ?? 0;
    return { counted, pending, withVariance, totalValueDelta };
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (q) {
        const hay = `${i.product?.name ?? ""} ${i.product?.sku ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === "variance") return i.physical_qty !== null && Number(i.variance) !== 0;
      if (filter === "pending") return i.physical_qty === null;
      return true;
    });
  }, [items, search, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button size="icon" variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <FileText className="h-5 w-5 text-primary" />
              {count?.reference ?? "…"}
              {count && (
                <Badge variant={statusVariant(count.status)}>
                  {t(`counts.status.${count.status}` as never)}
                </Badge>
              )}
            </h1>
            {count?.notes && <p className="text-sm text-muted-foreground">{count.notes}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && isDraft && (
            <Button onClick={() => startMut.mutate()} disabled={startMut.isPending} className="gap-2">
              {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t("counts.start")}
            </Button>
          )}
          {canEdit && isInProgress && (
            <>
              <Button variant="outline" onClick={() => setConfirmCancel(true)} className="gap-2">
                <XCircle className="h-4 w-4" /> {t("counts.cancel")}
              </Button>
              <Button onClick={() => setConfirmClose(true)} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> {t("counts.close")}
              </Button>
            </>
          )}
          {canEdit && (isDraft || count?.status === "cancelled") && (
            <Button variant="outline" className="gap-2 text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> {t("counts.delete")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={<ClipboardList className="h-4 w-4" />} label={t("counts.products")} value={items?.length ?? 0} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label={t("counts.itemsCounted")} value={stats.counted} />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label={t("counts.itemsWithVariance")} value={stats.withVariance} />
        <StatCard icon={<Scale className="h-4 w-4 text-primary" />} label={t("counts.totalVariance")} value={formatCurrency(stats.totalValueDelta, currency)} />
      </div>

      {isDraft && (
        <Card className="border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          {t("counts.startSnapshotHint")}
        </Card>
      )}

      {!isDraft && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b p-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("counts.scanOrSearch")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as ItemFilter)}>
              <TabsList>
                <TabsTrigger value="all">{t("counts.filter.all")}</TabsTrigger>
                <TabsTrigger value="pending">{t("counts.filter.pending")}</TabsTrigger>
                <TabsTrigger value="variance">{t("counts.filter.variance")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {canEdit && isInProgress && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => bulkSet("zero")}>{t("counts.fillAll")}</Button>
                <Button size="sm" variant="outline" onClick={() => bulkSet("match")}>{t("counts.matchSystem")}</Button>
              </div>
            )}
          </div>

          {itemsLoading ? (
            <div className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("counts.products")}</TableHead>
                  <TableHead className="text-right">{t("counts.systemQty")}</TableHead>
                  <TableHead className="text-right">{t("counts.physicalQty")}</TableHead>
                  <TableHead className="text-right">{t("counts.variance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    canEdit={canEdit && isInProgress}
                    onSave={(v) => updateItem(it.id, v)}
                  />
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("counts.close")}</AlertDialogTitle>
            <AlertDialogDescription>{t("counts.confirmClose")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => closeMut.mutate()}>{t("counts.close")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("counts.cancel")}</AlertDialogTitle>
            <AlertDialogDescription>{t("counts.confirmCancel")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancelMut.mutate()}>{t("counts.cancel")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("counts.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("counts.confirmDelete")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMut.mutate()} className="bg-destructive text-destructive-foreground">
              {t("counts.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function ItemRow({
  item, canEdit, onSave,
}: { item: CountItem; canEdit: boolean; onSave: (v: number | null) => void }) {
  const [local, setLocal] = useState<string>(item.physical_qty === null ? "" : String(item.physical_qty));
  const variance = (() => {
    if (local === "") return null;
    const n = Number(local);
    if (!Number.isFinite(n)) return null;
    return n - Number(item.system_qty);
  })();

  const commit = () => {
    if (local === "") {
      if (item.physical_qty !== null) onSave(null);
      return;
    }
    const n = Number(local);
    if (!Number.isFinite(n)) return;
    if (n !== Number(item.physical_qty)) onSave(n);
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{item.product?.name ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{item.product?.sku} · {item.product?.unit}</div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{Number(item.system_qty).toLocaleString()}</TableCell>
      <TableCell className="text-right">
        {canEdit ? (
          <Input
            type="number"
            inputMode="decimal"
            className="ml-auto h-9 w-28 text-right tabular-nums"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        ) : (
          <span className="tabular-nums">{item.physical_qty === null ? "—" : Number(item.physical_qty).toLocaleString()}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {variance === null ? (
          <span className="text-muted-foreground">—</span>
        ) : variance === 0 ? (
          <Badge variant="outline" className="tabular-nums">0</Badge>
        ) : (
          <Badge variant={variance > 0 ? "default" : "destructive"} className="tabular-nums">
            {variance > 0 ? "+" : ""}{variance.toLocaleString()}
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}