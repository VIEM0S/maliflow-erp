// Baseline + threshold benchmark for the audit search/sort path.
// Runs read-only SQL via psql against the managed DB when PGHOST is set.
// Usage:  node tests/perf/audit-benchmark.mjs [--rows 10000] [--budget-ms 100]
//
// Exits non-zero when any measured query exceeds its budget so CI can
// catch regressions on the indexes added in migration
// 20260707164755_..._audit_perf_indexes.sql (idx_audit_logs_tenant_created,
// _tenant_action, _tenant_entity_created, _preset_name).

import { execSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [],
  ),
);
const BUDGET_MS = Number(args["budget-ms"] ?? 100);
const SORT_BUDGET_MS = Number(args["sort-budget-ms"] ?? 120);
const SEARCH_BUDGET_MS = Number(args["search-budget-ms"] ?? 150);

if (!process.env.PGHOST) {
  console.log("SKIP: PGHOST not set (no exec DB access in this environment).");
  process.exit(0);
}

function psql(sql) {
  return execSync(`psql -Atqc ${JSON.stringify(sql)}`, {
    encoding: "utf8",
    env: process.env,
  }).trim();
}

function timedExplain(label, sql, budget) {
  // EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) gives us "Execution Time" in ms.
  const out = psql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const plan = JSON.parse(out)[0];
  const ms = plan["Execution Time"];
  const ok = ms <= budget;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(38)} ${ms.toFixed(1)}ms  (budget ${budget}ms)`);
  return ok;
}

// Pick any tenant that has audit rows to make the benchmark meaningful.
const tenant = psql(
  "SELECT tenant_id FROM public.audit_logs WHERE tenant_id IS NOT NULL " +
  "GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1;",
);
if (!tenant) {
  console.log("SKIP: no audit rows in DB — nothing to benchmark.");
  process.exit(0);
}
const T = `'${tenant}'::uuid`;

const checks = [
  ["list.paginated.default", `
    SELECT id FROM public.audit_logs
    WHERE tenant_id = ${T} AND entity = 'inventory_permission_preset'
    ORDER BY created_at DESC LIMIT 25 OFFSET 0`, BUDGET_MS],
  ["list.sort.action", `
    SELECT id FROM public.audit_logs
    WHERE tenant_id = ${T} AND entity = 'inventory_permission_preset'
    ORDER BY action ASC LIMIT 25`, SORT_BUDGET_MS],
  ["filter.actionFilter.update", `
    SELECT id FROM public.audit_logs
    WHERE tenant_id = ${T} AND action = 'preset.update'
    ORDER BY created_at DESC LIMIT 25`, BUDGET_MS],
  ["search.preset_name", `
    SELECT id FROM public.audit_logs
    WHERE tenant_id = ${T} AND entity = 'inventory_permission_preset'
      AND metadata->>'preset_name' ILIKE '%standard%'
    ORDER BY created_at DESC LIMIT 25`, SEARCH_BUDGET_MS],
];

let failed = 0;
for (const [label, sql, budget] of checks) {
  if (!timedExplain(label, sql, budget)) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} query/queries over budget — investigate index usage.`);
  process.exit(1);
}
console.log("\nAll audit query budgets respected.");