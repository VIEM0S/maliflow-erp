# RLS integration tests

`audit-tenant-isolation.sql` valide l'isolation multi-tenant pour
`public.audit_logs` et `public.tenants` en simulant plusieurs utilisateurs
(deux propriétaires + une caissière) via `SET LOCAL role authenticated` et
`request.jwt.claims`.

## Exécution

> ⚠️ Le script crée des utilisateurs de test dans `auth.users` et requiert
> le rôle Postgres `postgres` (superuser). Lancez-le contre une base de
> **développement locale** (`supabase start`) ou une base de **staging**,
> jamais en production.

```bash
# base locale (supabase start)
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres \
PGDATABASE=postgres bash tests/rls/run.sh
```

Sortie attendue en fin d'exécution :

```
NOTICE:  RLS ISOLATION TESTS PASSED
ROLLBACK
```

Toute assertion violée provoque un `ASSERTION FAILED: …` et un code de
sortie non nul. Le script s'exécute dans une transaction `BEGIN … ROLLBACK`
— aucune donnée résiduelle.

### Smoke test read-only (production-safe)

`smoke.sql` valide en lecture seule les invariants attendus sur la base
courante — pas de création de données, sans besoin de superuser :

```bash
psql -f tests/rls/smoke.sql
```

## Scénarios couverts

| # | Sujet | Attendu |
|---|-------|---------|
| T1 | Propriétaire A | Voit uniquement le journal + tenant A |
| T2 | Propriétaire B | Voit uniquement le journal + tenant B |
| T3 | Caissier de A | Ne voit **aucune** ligne d'audit ; peut insérer pour lui-même mais pas usurper `user_id` |
| T4 | Insert `tenants` | Interdit si `created_by ≠ auth.uid()` |
| T5 | Rôle `anon` | Aucune ligne visible (`audit_logs`, `tenants`) |

Voir `docs/security/rls-audit-and-tenants.md` pour la documentation des
politiques.