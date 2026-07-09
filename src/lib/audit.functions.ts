import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Access control for the preset audit journal.
 * Only tenant owners and super_admins are authorized. Any other role
 * (including active members) triggers a "audit.access_denied" record
 * inserted with elevated privileges so the attempt is always tracked
 * regardless of the caller's own INSERT rights.
 */
async function assertAuditAccess(
  supabase: any,
  userId: string,
  tenantId: string,
  action: "list" | "detail",
): Promise<void> {
  // Owner check via RLS-scoped client (respects memberships policies).
  const { data: ownerRow, error: ownerErr } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (ownerErr) throw ownerErr;

  const isOwner = ownerRow?.role === "owner";

  // Super-admin check (global, tenant_id-independent).
  const { data: superRow } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .maybeSingle();
  const isSuper = !!superRow;

  if (isOwner || isSuper) return;

  // Denied — log via admin client so RLS cannot silently drop the record.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: userId,
    action: `audit.access_denied.${action}`,
    entity: "audit_logs",
    entity_id: null,
    metadata: {
      reason: "insufficient_permissions",
      required_role: ["owner", "super_admin"],
      observed_role: ownerRow?.role ?? null,
      action,
    },
  });

  const err = new Error("Forbidden: audit log access requires owner role") as Error & {
    statusCode?: number;
    code?: string;
  };
  err.statusCode = 403;
  err.code = "AUDIT_FORBIDDEN";
  throw err;
}

const listInput = z.object({
  tenantId: z.string().uuid(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  sortBy: z.enum(["created_at", "action"]).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(120).optional(),
  actionFilter: z.enum(["all", "create", "update", "delete", "apply"]).default("all"),
});

export const listPresetAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAuditAccess(context.supabase, context.userId, data.tenantId, "list");
    const from = data.page * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("audit_logs")
      .select(
        "id,action,entity,entity_id,user_id,created_at,preset_name:metadata->>preset_name",
        { count: "exact" },
      )
      .eq("tenant_id", data.tenantId)
      .eq("entity", "inventory_permission_preset");
    if (data.actionFilter !== "all") {
      query = query.eq("action", `preset.${data.actionFilter}`);
    }
    if (data.search && data.search.length > 0) {
      // Escape PostgREST reserved chars in ilike patterns.
      const raw = data.search.replace(/[%,()]/g, " ").trim();
      if (raw.length > 0) {
        const pat = `%${raw}%`;
        query = query.or(
          `action.ilike.${pat},metadata->>preset_name.ilike.${pat}`,
        );
      }
    }
    const { data: rows, error, count } = await query
      .order(data.sortBy, { ascending: data.sortDir === "asc" })
      .range(from, to);
    if (error) throw error;
    return { rows: rows ?? [], total: count ?? 0 };
  });

const detailInput = z.object({
  tenantId: z.string().uuid(),
  id: z.string().uuid(),
});

export const getPresetAuditDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => detailInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAuditAccess(context.supabase, context.userId, data.tenantId, "detail");
    const { data: row, error } = await context.supabase
      .from("audit_logs")
      .select("id,ip_address,metadata")
      .eq("id", data.id)
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    if (error) throw error;
    return row ?? null;
  });

// ---------------------------------------------------------------------------
// CSV export — same RLS gate + same search/actionFilter as listPresetAudit.
// Streams up to `maxRows` rows (capped server-side) as a single CSV string.
// ---------------------------------------------------------------------------
const exportInput = z.object({
  tenantId: z.string().uuid(),
  sortBy: z.enum(["created_at", "action"]).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(120).optional(),
  actionFilter: z.enum(["all", "create", "update", "delete", "apply"]).default("all"),
  maxRows: z.number().int().min(1).max(10_000).default(5_000),
});

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportPresetAuditCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => exportInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAuditAccess(context.supabase, context.userId, data.tenantId, "list");
    let query = context.supabase
      .from("audit_logs")
      .select(
        "id,action,entity,entity_id,user_id,created_at,preset_name:metadata->>preset_name",
      )
      .eq("tenant_id", data.tenantId)
      .eq("entity", "inventory_permission_preset");
    if (data.actionFilter !== "all") {
      query = query.eq("action", `preset.${data.actionFilter}`);
    }
    if (data.search && data.search.length > 0) {
      const raw = data.search.replace(/[%,()]/g, " ").trim();
      if (raw.length > 0) {
        const pat = `%${raw}%`;
        query = query.or(
          `action.ilike.${pat},metadata->>preset_name.ilike.${pat}`,
        );
      }
    }
    const { data: rows, error } = await query
      .order(data.sortBy, { ascending: data.sortDir === "asc" })
      .range(0, data.maxRows - 1);
    if (error) throw error;
    const header = [
      "id",
      "created_at",
      "action",
      "preset_name",
      "entity",
      "entity_id",
      "user_id",
    ];
    const lines = [header.join(",")];
    for (const r of rows ?? []) {
      lines.push([
        r.id,
        r.created_at,
        r.action,
        (r as any).preset_name,
        r.entity,
        r.entity_id,
        r.user_id,
      ].map(csvEscape).join(","));
    }
    return { csv: lines.join("\n"), count: rows?.length ?? 0 };
  });