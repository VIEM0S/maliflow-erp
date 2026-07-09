# Audit performance benchmark

`audit-benchmark.mjs` runs `EXPLAIN (ANALYZE, BUFFERS)` on the four
critical query shapes served by `listPresetAudit`:

| Label | What it exercises | Default budget |
| --- | --- | --- |
| `list.paginated.default` | Default pagination + sort by `created_at desc` — uses `idx_audit_logs_tenant_created`. | 100 ms |
| `list.sort.action` | Sort by `action` — uses `idx_audit_logs_tenant_action`. | 120 ms |
| `filter.actionFilter.update` | `actionFilter = update` — should hit `idx_audit_logs_tenant_action`. | 100 ms |
| `search.preset_name` | `ilike '%…%'` on `metadata->>'preset_name'` — should hit the partial index `idx_audit_logs_preset_name`. | 150 ms |

## CI usage

```bash
node tests/perf/audit-benchmark.mjs
```

Requires `PG*` env vars (managed exec DB access). Exits 0 with SKIP when
not available so CI stays green on environments without DB access, and
exits non-zero when any query exceeds its budget — the signal to
investigate the query plan and add or refine an index rather than
silently regressing search / sort latency.

## Adjusting budgets

Pass `--budget-ms`, `--sort-budget-ms`, or `--search-budget-ms` to tune
individual thresholds. Do NOT relax a threshold to make CI green — the
intent is to catch regressions, so investigate the plan first
(`EXPLAIN (ANALYZE, BUFFERS)` on the failing query).