# RLS integration tests

`audit-tenant-isolation.sql` valide l'isolation multi-tenant pour
`public.audit_logs` et `public.tenants` en simulant plusieurs utilisateurs
(deux propriétaires + une caissière) via `SET LOCAL role authenticated` et
`request.jwt.claims`.

## Exécution

```bash
bash tests/rls/run.sh
```

Sortie attendue en fin d'exécution :

```
NOTICE:  RLS ISOLATION TESTS PASSED
ROLLBACK
```

Toute assertion violée provoque un `ASSERTION FAILED: …` et un code de
sortie non nul. Le script s'exécute dans une transaction `BEGIN … ROLLBACK`
— aucune donnée résiduelle.

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