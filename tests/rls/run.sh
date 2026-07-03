#!/usr/bin/env bash
# Runs the RLS multi-tenant isolation tests against the current database.
# Requires PG* env vars (PGHOST/PGUSER/PGPASSWORD/PGDATABASE) — already set
# in the Lovable dev sandbox.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
psql -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/audit-tenant-isolation.sql"