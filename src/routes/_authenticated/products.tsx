import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Upload, Download, Search, Edit3, Trash2, Tag, Package,
  Barcode, MoreHorizontal, Loader2, FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import type { AppRole } from "@/hooks/use-tenant";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Produits — Alpha ERP" }] }),
  component: () => <AppShell>{(ctx) => <ProductsPage {...ctx} />}</AppShell>,
});

type Category = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  is_active: boolean;
};

type Product = {
  id: string;
  tenant_id: string;
  category_id: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unit: string;
  cost_price: number;
  sale_price: number;
  tax_rate: number;
  min_stock: number;
  is_active: boolean;
  category?: { id: string; name: string; color: string | null } | null;
};

type ProductForm = {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  category_id: string | null;
  unit: string;
  cost_price: string;
  sale_price: string;
  tax_rate: string;
  min_stock: string;
  description: string;
  is_active: boolean;
};

const EMPTY_FORM: ProductForm = {
  name: "", sku: "", barcode: "", category_id: null,
  unit: "unit", cost_price: "0", sale_price: "0", tax_rate: "0", min_stock: "0",
  description: "", is_active: true,
};

function ProductsPage({ tenantId, role, currency }: { tenantId: string; role: AppRole; currency: string }) {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = role === "owner" || role === "manager" || role === "super_admin";
  const canDelete = role === "owner" || role === "super_admin";

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ["products", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, category:categories(id, name, color)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Product[];
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, color, description, is_active")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const products = productsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter === "none" && p.category_id) return false;
      if (categoryFilter !== "all" && categoryFilter !== "none" && p.category_id !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [products, search, categoryFilter]);

  const upsertMutation = useMutation({
    mutationFn: async (f: ProductForm) => {
      const payload = {
        tenant_id: tenantId,
        name: f.name.trim(),
        sku: f.sku.trim(),
        barcode: f.barcode.trim() || null,
        category_id: f.category_id || null,
        unit: f.unit.trim() || "unit",
        cost_price: Number(f.cost_price) || 0,
        sale_price: Number(f.sale_price) || 0,
        tax_rate: Number(f.tax_rate) || 0,
        min_stock: Number(f.min_stock) || 0,
        description: f.description.trim() || null,
        is_active: f.is_active,
      };
      if (f.id) {
        const { error } = await supabase.from("products").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products", tenantId] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      toast.success(form.id ? "Produit mis à jour" : "Produit créé");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products", tenantId] });
      setDeleteId(null);
      toast.success("Produit supprimé");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => { setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (p: Product) => {
    setForm({
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode ?? "",
      category_id: p.category_id, unit: p.unit,
      cost_price: String(p.cost_price), sale_price: String(p.sale_price),
      tax_rate: String(p.tax_rate), min_stock: String(p.min_stock),
      description: p.description ?? "", is_active: p.is_active,
    });
    setDialogOpen(true);
  };

  const handleExport = () => {
    const rows = [
      ["name", "sku", "barcode", "category", "cost_price", "sale_price", "unit", "min_stock", "is_active"],
      ...products.map((p) => [
        p.name, p.sku, p.barcode ?? "", p.category?.name ?? "",
        p.cost_price, p.sale_price, p.unit, p.min_stock, p.is_active ? "1" : "0",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => {
      const s = String(c ?? "");
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `produits-${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" /> {t("products.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("products.sub")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
            <Tag className="h-4 w-4 mr-1.5" /> {t("products.categories")}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> {t("products.import")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={products.length === 0}>
            <Download className="h-4 w-4 mr-1.5" /> {t("products.export")}
          </Button>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> {t("products.new")}
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total produits" value={products.length} />
        <KpiCard label="Actifs" value={products.filter((p) => p.is_active).length} />
        <KpiCard label="Catégories" value={categories.length} />
        <KpiCard label="Avec code-barres" value={products.filter((p) => p.barcode).length} />
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("products.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="md:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("products.allCategories")}</SelectItem>
              <SelectItem value="none">{t("products.noCategory")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {productsQuery.isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">{t("products.empty")}</p>
            {canEdit && (
              <Button size="sm" className="mt-4" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("products.new")}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("products.col.name")}</TableHead>
                  <TableHead>{t("products.col.sku")}</TableHead>
                  <TableHead>{t("products.col.barcode")}</TableHead>
                  <TableHead>{t("products.col.category")}</TableHead>
                  <TableHead className="text-right">{t("products.col.cost")}</TableHead>
                  <TableHead className="text-right">{t("products.col.price")}</TableHead>
                  <TableHead className="text-right">{t("products.col.minStock")}</TableHead>
                  <TableHead>{t("products.col.status")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id} className="group">
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{p.name}</span>
                        {p.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">{p.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.barcode ? (
                        <span className="inline-flex items-center gap-1">
                          <Barcode className="h-3 w-3 text-muted-foreground" /> {p.barcode}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {p.category ? (
                        <Badge variant="outline" className="font-normal" style={{ borderColor: p.category.color ?? undefined, color: p.category.color ?? undefined }}>
                          {p.category.name}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{formatCurrency(Number(p.cost_price), currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatCurrency(Number(p.sale_price), currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{Number(p.min_stock)} {p.unit}</TableCell>
                    <TableCell>
                      {p.is_active
                        ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400">{t("products.active")}</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">{t("products.inactive")}</Badge>}
                    </TableCell>
                    <TableCell>
                      {(canEdit || canDelete) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openEdit(p)}>
                                <Edit3 className="h-4 w-4 mr-2" /> Modifier
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(p.id)}>
                                  <Trash2 className="h-4 w-4 mr-2" /> Supprimer
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Product dialog */}
      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        categories={categories}
        onSubmit={() => {
          if (!form.name.trim() || !form.sku.trim()) {
            toast.error(t("products.form.required"));
            return;
          }
          upsertMutation.mutate(form);
        }}
        saving={upsertMutation.isPending}
      />

      {/* Categories sheet */}
      <CategoriesSheet
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        tenantId={tenantId}
        canEdit={canEdit}
        categories={categories}
      />

      {/* CSV import */}
      <CsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        tenantId={tenantId}
        categories={categories}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("products.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est définitive. L'historique de ce produit restera dans les ventes passées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function ProductDialog({
  open, onOpenChange, form, setForm, categories, onSubmit, saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  form: ProductForm;
  setForm: (f: ProductForm) => void;
  categories: Category[];
  onSubmit: () => void;
  saving: boolean;
}) {
  const t = useT();
  const update = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setForm({ ...form, [k]: v });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? t("products.edit") : t("products.new")}</DialogTitle>
          <DialogDescription>Informations produit, prix et inventaire.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="p-name">Nom du produit *</Label>
            <Input id="p-name" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="ex. Marteau 500g" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-sku">SKU *</Label>
              <Input id="p-sku" value={form.sku} onChange={(e) => update("sku", e.target.value)} placeholder="MAR-500" className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-barcode">Code-barres</Label>
              <Input id="p-barcode" value={form.barcode} onChange={(e) => update("barcode", e.target.value)} placeholder="3760000000000" className="font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Catégorie</Label>
              <Select value={form.category_id ?? "none"} onValueChange={(v) => update("category_id", v === "none" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("products.noCategory")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-unit">Unité</Label>
              <Input id="p-unit" value={form.unit} onChange={(e) => update("unit", e.target.value)} placeholder="unit, kg, m, l…" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-cost">Coût d'achat</Label>
              <Input id="p-cost" type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => update("cost_price", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-price">Prix de vente</Label>
              <Input id="p-price" type="number" min="0" step="0.01" value={form.sale_price} onChange={(e) => update("sale_price", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-tax">TVA (%)</Label>
              <Input id="p-tax" type="number" min="0" step="0.01" value={form.tax_rate} onChange={(e) => update("tax_rate", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-min">Stock minimum (alerte)</Label>
            <Input id="p-min" type="number" min="0" step="0.001" value={form.min_stock} onChange={(e) => update("min_stock", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea id="p-desc" rows={2} value={form.description} onChange={(e) => update("description", e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Produit actif</p>
              <p className="text-xs text-muted-foreground">Visible à la caisse et dans les ventes</p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={(v) => update("is_active", v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesSheet({
  open, onOpenChange, tenantId, canEdit, categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  canEdit: boolean;
  categories: Category[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");

  const createCat = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("categories").insert({
        tenant_id: tenantId, name: name.trim(), color,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories", tenantId] });
      setName("");
      toast.success("Catégorie créée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories", tenantId] });
      qc.invalidateQueries({ queryKey: ["products", tenantId] });
      toast.success("Catégorie supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Tag className="h-4 w-4" /> {t("categories.title")}</SheetTitle>
          <SheetDescription>Organisez votre catalogue.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {canEdit && (
            <div className="rounded-lg border p-3 space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("categories.new")}</Label>
              <div className="flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("categories.namePh")} />
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-background"
                />
                <Button onClick={() => name.trim() && createCat.mutate()} disabled={!name.trim() || createCat.isPending} size="sm">
                  {createCat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("categories.empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md border p-2.5 group">
                  <div className="flex items-center gap-2.5">
                    <span className="h-3 w-3 rounded-full" style={{ background: c.color ?? "#94a3b8" }} />
                    <span className="text-sm font-medium">{c.name}</span>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={() => deleteCat.mutate(c.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Minimal CSV parser supporting quoted fields and escaped quotes
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === "," || c === ";") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((v) => v.trim().length > 0));
}

type CsvRow = {
  name: string; sku: string; barcode: string; category: string;
  cost_price: number; sale_price: number; unit: string; min_stock: number; is_active: boolean;
  _error?: string;
};

function CsvImportDialog({
  open, onOpenChange, tenantId, categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  categories: Category[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string>("");

  const reset = () => { setRows([]); setFileName(""); if (inputRef.current) inputRef.current.value = ""; };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 2) { toast.error("CSV vide ou invalide"); return; }
    const header = parsed[0].map((h) => h.trim().toLowerCase());
    const idx = (k: string) => header.indexOf(k);
    const iName = idx("name"), iSku = idx("sku");
    if (iName < 0 || iSku < 0) { toast.error("Colonnes 'name' et 'sku' obligatoires"); return; }
    const out: CsvRow[] = parsed.slice(1).map((cols) => {
      const get = (k: string) => { const i = idx(k); return i >= 0 ? (cols[i] ?? "").trim() : ""; };
      const row: CsvRow = {
        name: get("name"),
        sku: get("sku"),
        barcode: get("barcode"),
        category: get("category"),
        cost_price: Number(get("cost_price")) || 0,
        sale_price: Number(get("sale_price")) || 0,
        unit: get("unit") || "unit",
        min_stock: Number(get("min_stock")) || 0,
        is_active: !["0", "false", "non", "no"].includes(get("is_active").toLowerCase()),
      };
      if (!row.name || !row.sku) row._error = "Nom ou SKU manquant";
      return row;
    });
    setFileName(file.name);
    setRows(out);
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const valid = rows.filter((r) => !r._error);
      if (valid.length === 0) throw new Error("Aucune ligne valide");
      const catMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
      // Create missing categories
      const missing = Array.from(new Set(valid.map((r) => r.category).filter((n) => n && !catMap.has(n.toLowerCase()))));
      if (missing.length) {
        const { data, error } = await supabase
          .from("categories")
          .insert(missing.map((name) => ({ tenant_id: tenantId, name })))
          .select("id, name");
        if (error) throw error;
        (data ?? []).forEach((c: { id: string; name: string }) => catMap.set(c.name.toLowerCase(), c.id));
      }
      const payload = valid.map((r) => ({
        tenant_id: tenantId,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode || null,
        category_id: r.category ? catMap.get(r.category.toLowerCase()) ?? null : null,
        unit: r.unit,
        cost_price: r.cost_price,
        sale_price: r.sale_price,
        min_stock: r.min_stock,
        is_active: r.is_active,
      }));
      const { error } = await supabase
        .from("products")
        .upsert(payload, { onConflict: "tenant_id,sku" });
      if (error) throw error;
      return valid.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["products", tenantId] });
      qc.invalidateQueries({ queryKey: ["categories", tenantId] });
      toast.success(t("csv.imported").replace("{n}", String(n)));
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadTemplate = () => {
    const tpl = "name,sku,barcode,category,cost_price,sale_price,unit,min_stock,is_active\nMarteau 500g,MAR-500,3760000000000,Outillage,2500,4000,unit,5,1\n";
    const blob = new Blob(["\uFEFF" + tpl], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "modele-produits.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = rows.filter((r) => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> {t("csv.title")}</DialogTitle>
          <DialogDescription>{t("csv.help")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" /> {t("csv.choose")}
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1.5" /> {t("csv.downloadTemplate")}
            </Button>
            <input
              ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {fileName && <span className="text-xs text-muted-foreground self-center">{fileName}</span>}
          </div>
          {rows.length > 0 && (
            <>
              <div className="flex gap-2 text-xs">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">{validCount} valides</Badge>
                {errorCount > 0 && <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">{errorCount} erreurs</Badge>}
              </div>
              <div className="border rounded-md max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6"></TableHead>
                      <TableHead>Nom</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead className="text-right">Prix</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 50).map((r, i) => (
                      <TableRow key={i} className={r._error ? "bg-destructive/5" : ""}>
                        <TableCell>{r._error ? "⚠" : "✓"}</TableCell>
                        <TableCell className="text-sm">{r.name || <em className="text-muted-foreground">vide</em>}</TableCell>
                        <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell className="text-xs">{r.category || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{r.sale_price}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center p-2">+ {rows.length - 50} autres lignes</p>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => importMut.mutate()} disabled={validCount === 0 || importMut.isPending}>
            {importMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {t("csv.import").replace("{n}", String(validCount))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}