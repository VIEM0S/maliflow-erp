import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Server-side tenant creation.
 *
 * The onboarding form previously inserted into `public.tenants` directly
 * from the browser. When the Supabase JS client had a stale/missing
 * session, `auth.uid()` was NULL on the request and PostgREST rejected
 * the insert with "new row violates row-level security policy for table
 * tenants" (policy `tenants_insert_self`).
 *
 * Running the write through a server function guarantees:
 *  - the caller is authenticated (requireSupabaseAuth → 401 otherwise);
 *  - `created_by` is bound to the middleware-verified `userId` so the
 *    `tenants_insert_self` WITH CHECK clause (`created_by = auth.uid()`)
 *    always matches;
 *  - the owner `memberships` row and default store are provisioned in
 *    the same server round-trip, keeping the tenant consistent even if
 *    the browser tab is closed between steps.
 */
const input = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(160),
  city: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(40).nullish(),
  rccm: z.string().trim().max(60).nullish(),
  nif: z.string().trim().max(60).nullish(),
  address: z.string().trim().max(200).nullish(),
  country: z.string().length(2),
  currency: z.string().length(3),
});

export const createTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    // Insert via RLS-scoped client — created_by is bound to the verified
    // JWT sub so `tenants_insert_self` always passes.
    const { data: tenant, error: tErr } = await context.supabase
      .from("tenants")
      .insert({
        name: data.name,
        slug: data.slug,
        city: data.city || null,
        phone: data.phone || null,
        rccm: data.rccm || null,
        nif: data.nif || null,
        address: data.address || null,
        country: data.country,
        currency: data.currency,
        created_by: uid,
      })
      .select("id")
      .single();
    if (tErr) throw tErr;

    const { error: mErr } = await context.supabase.from("memberships").insert({
      user_id: uid,
      tenant_id: tenant.id,
      role: "owner",
    });
    if (mErr) throw mErr;

    await context.supabase.from("stores").insert({
      tenant_id: tenant.id,
      name: data.city ? `${data.name} — ${data.city}` : `${data.name} — Principal`,
    });

    return { id: tenant.id as string };
  });