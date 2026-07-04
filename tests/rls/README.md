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
| T6 | Injection d'ID cross-tenant (drawer) | Charger le détail d'un audit d'un autre tenant renvoie 0 ligne, même en usurpant `tenant_id` |
| T7 | Tentative refusée = 1 entrée `audit.access_denied` | Chaque refus crée exactement 1 ligne avec `user_id`, `tenant_id`, `reason=insufficient_permissions` |

Voir `docs/security/rls-audit-and-tenants.md` pour la documentation des
politiques.

## Tests E2E

`tests/e2e/audit-access-denied.spec.py` lance Playwright, restaure la
session Supabase managée (`LOVABLE_BROWSER_SUPABASE_*`) et vérifie :

1. La page `/permissions` affiche bien la carte « Accès refusé » pour un
   utilisateur non-propriétaire.
2. L'appel serveur `listPresetAudit` renvoie un HTTP 401 ou 403 pour ce
   même utilisateur.

```bash
python3 tests/e2e/audit-access-denied.spec.py
```