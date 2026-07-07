// Standalone unit tests for the listPresetAudit / getPresetAuditDetail
// input validators. Runs with plain node — no test runner required:
//
//   node tests/unit/audit-input-validation.mjs
//
// The goal is to prove that URL-borne query params cannot bypass:
//   - action filter allow-list (no SQL-injection-shaped values sneak in)
//   - search length cap and trimming
//   - pagination / sort bounds
//   - tenantId / id UUID shape

import { z } from "zod";

// Mirror of the schemas in src/lib/audit.functions.ts. Kept in sync by
// the review checklist in docs/security/rls-audit-and-tenants.md.
const listInput = z.object({
  tenantId: z.string().uuid(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  sortBy: z.enum(["created_at", "action"]).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(120).optional(),
  actionFilter: z.enum(["all", "create", "update", "delete", "apply"]).default("all"),
});

const detailInput = z.object({
  tenantId: z.string().uuid(),
  id: z.string().uuid(),
});

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function rejects(fn, msg) {
  try { fn(); throw new Error("expected rejection: " + msg); }
  catch (e) { if (e.message.startsWith("expected rejection")) throw e; }
}

const T = "11111111-1111-4111-8111-111111111111";

console.log("listPresetAudit input validation");
check("accepts a well-formed request", () => {
  const v = listInput.parse({ tenantId: T });
  assert(v.page === 0 && v.pageSize === 25 && v.sortBy === "created_at"
    && v.sortDir === "desc" && v.actionFilter === "all", "defaults wrong");
});
check("rejects non-UUID tenantId (query-string injection)", () =>
  rejects(() => listInput.parse({ tenantId: "'; DROP TABLE audit_logs; --" })));
check("rejects actionFilter outside the allow-list", () => {
  rejects(() => listInput.parse({ tenantId: T, actionFilter: "all;--" }));
  rejects(() => listInput.parse({ tenantId: T, actionFilter: "preset.update" }));
  rejects(() => listInput.parse({ tenantId: T, actionFilter: "" }));
});
check("rejects sortBy / sortDir outside the allow-list", () => {
  rejects(() => listInput.parse({ tenantId: T, sortBy: "user_id" }));
  rejects(() => listInput.parse({ tenantId: T, sortDir: "ASC" }));
});
check("caps search length at 120 and trims whitespace", () => {
  const v = listInput.parse({ tenantId: T, search: "  hello  " });
  assert(v.search === "hello", "not trimmed");
  rejects(() => listInput.parse({ tenantId: T, search: "x".repeat(121) }));
});
check("bounds pageSize (1..200) and page (>=0)", () => {
  rejects(() => listInput.parse({ tenantId: T, page: -1 }));
  rejects(() => listInput.parse({ tenantId: T, pageSize: 0 }));
  rejects(() => listInput.parse({ tenantId: T, pageSize: 201 }));
  const v = listInput.parse({ tenantId: T, page: 3, pageSize: 100 });
  assert(v.page === 3 && v.pageSize === 100, "bounds valid");
});

console.log("getPresetAuditDetail input validation");
check("rejects non-UUID id (cross-tenant probing via query param)", () => {
  rejects(() => detailInput.parse({ tenantId: T, id: "not-a-uuid" }));
  rejects(() => detailInput.parse({ tenantId: T, id: "*" }));
});
check("accepts a well-formed request", () => {
  detailInput.parse({ tenantId: T, id: T });
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll input-validation checks passed.");