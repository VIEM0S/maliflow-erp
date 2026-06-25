import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Boxes, Plus, ArrowDownToLine, ArrowUpFromLine, Settings2,
  AlertTriangle, Search, Loader2, History, Trash2,
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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import type { AppRole } from "@/hooks/use-tenant";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Stock — Alpha ERP" }] }),
  component: () => <AppShell>{(ctx) => <InventoryPage {...ctx} />}</AppShell>,
});

type MovementType = "in" | "out" | "adjustment";

type Balance = {
  tenant_id: string;
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  min_stock: number;
  on_hand: number;
  stock_value: number;
};

type Movement = {
  id: string;
  tenant_id: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost: number | null;
  reason: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  product?: { id: string; name: string; sku: string; unit: string } | null;
};

type ProductLite = { id: string; name: string; sku: string; unit: string; cost_price: number };

type Filter = "all" | "low" | "out";

function InventoryPage({ tenantId, role, currency }: { tenantId: string; role: AppRole; currency: string }) {
  const t = useT();
  const canEdit = role === "owner" || role === "manager" || role === "super_admin";
  const canDelete = role === "owner" || role === "super_admin";

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetProductId, setPresetProductId] = useState<string | null>(null);
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ["stock-balances", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_stock_balances")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        on_hand: Number(r.on_hand),
        stock_value: Number(r.stock_value),
        min_stock: Number(r.min_stock),
      })) as Balance[];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["products-lite", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, unit, cost_price")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ProductLite[];
    },
  });

  const balances = balancesQuery.data ?? [];
  const products = productsQuery.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances.filter((b) => {
      if (filter === "low" && !(b.on_hand <= b.min_stock && b.on_hand > 0)) return false;
      if (filter === "out" && b.on_hand > 0) return false;
      if (!q) return true;
      return b.name.toLowerCase().includes(q) || b.sku.toLowerCase().includes(q);
    });
  }, [balances, search, filter]);

  const totals = useMemo(() => ({
    total: balances.length,
    value: balances.reduce((s, b) => s + b.stock_value, 0),
    low: balances.filter((b) => b.on_hand <= b.min_stock && b.on_hand > 0).length,
    out: balances.filter((b) => b.on_hand <= 0).length,
  }), [balances]);

  const openMovement = (productId?: string) => {
    setPresetProductId(productId ?? null);
    setDialogOpen(true);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> {t("stock.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("stock.sub")}</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => openMovement()}>
            <Plus className="h-4 w-4 mr-1.5" /> {t("stock.new")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Références" value={totals.total.toString()} />
        <Kpi label={t("stock.value")} value={formatCurrency(totals.value, currency)} />
        <Kpi label={t("stock.lowStock")} value={totals.low.toString()} tone={totals.low ? "warn" : undefined} />
        <Kpi label={t("stock.outOfStock")} value={totals.out.toString()} tone={totals.out ? "danger" : undefined} />
      </div>

      <Card className="p-3">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par nom ou SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">Tous</TabsTrigger>
              <TabsTrigger value="low">{t("stock.lowStock")}</TabsTrigger>
              <TabsTrigger value="out">{t("stock.outOfStock")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {balancesQuery.isLoading ? (
          <div className="p-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Boxes className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {balances.length === 0 ? "Créez d'abord des produits, puis enregistrez des mouvements." : "Aucun résultat."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stock.product")}</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">{t("stock.onHand")}</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">{t("stock.value")}</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => {
                  const isOut = b.on_hand <= 0;
                  const isLow = !isOut && b.on_hand <= b.min_stock;
                  return (
                    <TableRow key={b.product_id} className="group">
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${isOut ? "text-destructive" : isLow ? "text-amber-600 dark:text-amber-400" : ""}`}>
                        {b.on_hand} <span className="text-xs font-normal text-muted-foreground">{b.unit}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{b.min_stock}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCurrency(b.stock_value, currency)}</TableCell>
                      <TableCell>
                        {isOut ? (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                            <AlertTriangle className="h-3 w-3 mr-1" /> {t("stock.outOfStock")}
                          </Badge>
                        ) : isLow ? (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200">
                            {t("stock.lowStock")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title={t("stock.history")} onClick={() => setHistoryProductId(b.product_id)}>
                            <History className="h-4 w-4" />
                          </Button>
                          {canEdit && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={t("stock.new")} onClick={() => openMovement(b.product_id)}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <MovementDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setPresetProductId(null); }}
        tenantId={tenantId}
        products={products}
        presetProductId={presetProductId}
      />
      <HistorySheet
        open={!!historyProductId}
        onOpenChange={(o) => !o && setHistoryProductId(null)}
        tenantId={tenantId}
        productId={historyProductId}
        currency={currency}
        canDelete={canDelete}
      />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" | "danger" }) {
  const cls = tone === "danger"
    ? "text-destructive"
    : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
    </Card>
  );
}

function MovementDialog({
  open, onOpenChange, tenantId, products, presetProductId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  products: ProductLite[];
  presetProductId: string | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [type, setType] = useState<MovementType>("in");
  const [productId, setProductId] = useState<string>(presetProductId ?? "");
  const [quantity, setQuantity] = useState<string>("1");
  const [unitCost, setUnitCost] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Sync preset when reopening
  useMemo(() => {
    if (open) {
      setProductId(presetProductId ?? "");
      setType("in"); setQuantity("1"); setUnitCost(""); setReason(""); setReference(""); setNotes("");
    }
  }, [open, presetProductId]);

  const product = products.find((p) => p.id === productId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error("Sélectionnez un produit");
      const qty = Number(quantity);
      if (!qty || qty === 0) throw new Error("Quantité invalide");
      // adjustment can be negative; for storage convert to type+positive qty
      let finalType: MovementType = type;
      let finalQty = Math.abs(qty);
      if (type === "adjustment" && qty < 0) {
        // store as signed adjustment via 'adjustment' with negative quantity? Our check is >0; so store negative ones as 'out'
        finalType = "out";
      } else if (type === "adjustment" && qty > 0) {
        finalType = "adjustment";
      }
      const { error } = await supabase.from("stock_movements").insert({
        tenant_id: tenantId,
        product_id: productId,
        movement_type: finalType,
        quantity: finalQty,
        unit_cost: unitCost ? Number(unitCost) : null,
        reason: reason.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock-balances", tenantId] });
      qc.invalidateQueries({ queryKey: ["stock-movements", tenantId] });
      toast.success("Mouvement enregistré");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("stock.new")}</DialogTitle>
          <DialogDescription>Enregistrez une entrée, une sortie ou un ajustement.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-2">
            <TypeButton current={type} value="in" onClick={() => setType("in")} icon={<ArrowDownToLine className="h-4 w-4" />} label={t("stock.in")} tone="emerald" />
            <TypeButton current={type} value="out" onClick={() => setType("out")} icon={<ArrowUpFromLine className="h-4 w-4" />} label={t("stock.out")} tone="rose" />
            <TypeButton current={type} value="adjustment" onClick={() => setType("adjustment")} icon={<Settings2 className="h-4 w-4" />} label={t("stock.adjustment")} tone="amber" />
          </div>

          <div className="grid gap-2">
            <Label>{t("stock.product")}</Label>
            <Select value={productId} onValueChange={(v) => {
              setProductId(v);
              const p = products.find((x) => x.id === v);
              if (p && type === "in" && !unitCost) setUnitCost(String(p.cost_price));
            }}>
              <SelectTrigger><SelectValue placeholder="Choisir un produit…" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{p.sku}</span>{p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t("stock.quantity")} {product && <span className="text-xs text-muted-foreground">({product.unit})</span>}</Label>
              <Input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t("stock.unitCost")}</Label>
              <Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="Optionnel" />
            </div>
          </div>

          {type === "adjustment" && (
            <p className="text-xs text-muted-foreground">{t("stock.adjustmentHint")}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t("stock.reason")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Achat, casse, inventaire…" />
            </div>
            <div className="grid gap-2">
              <Label>{t("stock.reference")}</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° facture, BL…" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("stock.notes")}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypeButton({ current, value, onClick, icon, label, tone }: {
  current: MovementType; value: MovementType; onClick: () => void;
  icon: React.ReactNode; label: string; tone: "emerald" | "rose" | "amber";
}) {
  const active = current === value;
  const palette = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-md border p-3 text-sm transition ${active ? palette + " font-medium shadow-sm" : "border-border hover:bg-accent/30 text-muted-foreground"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function HistorySheet({
  open, onOpenChange, tenantId, productId, currency, canDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  productId: string | null;
  currency: string;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const t = useT();
  const query = useQuery({
    queryKey: ["stock-movements", tenantId, productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*, product:products(id, name, sku, unit)")
        .eq("tenant_id", tenantId)
        .eq("product_id", productId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Movement[];
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stock_movements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock-movements", tenantId, productId] });
      qc.invalidateQueries({ queryKey: ["stock-balances", tenantId] });
      toast.success("Mouvement supprimé");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const movements = query.data ?? [];
  const product = movements[0]?.product;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><History className="h-4 w-4" /> {t("stock.history")}</SheetTitle>
          <SheetDescription>{product?.name ?? "Mouvements"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {query.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Aucun mouvement.</p>
          ) : (
            <ul className="space-y-2">
              {movements.map((m) => (
                <li key={m.id} className="rounded-md border p-3 group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <MovementIcon type={m.movement_type} />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold tabular-nums">
                            {m.movement_type === "out" ? "−" : m.movement_type === "in" ? "+" : "±"}
                            {Number(m.quantity)}
                          </span>
                          <span className="text-xs text-muted-foreground">{m.product?.unit}</span>
                          <Badge variant="outline" className="text-[10px]">{t(`stock.${m.movement_type}` as any)}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(m.created_at).toLocaleString("fr-FR")}
                        </p>
                        {(m.reason || m.reference) && (
                          <p className="text-xs mt-1">
                            {m.reason && <span>{m.reason}</span>}
                            {m.reference && <span className="ml-2 font-mono text-muted-foreground">#{m.reference}</span>}
                          </p>
                        )}
                        {m.notes && <p className="text-xs text-muted-foreground mt-1">{m.notes}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      {m.unit_cost != null && (
                        <p className="text-xs tabular-nums">{formatCurrency(Number(m.unit_cost), currency)}<span className="text-muted-foreground">/u</span></p>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 mt-1 opacity-0 group-hover:opacity-100 text-destructive"
                          onClick={() => delMut.mutate(m.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MovementIcon({ type }: { type: MovementType }) {
  if (type === "in") return <ArrowDownToLine className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  if (type === "out") return <ArrowUpFromLine className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />;
  return <Settings2 className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />;
}