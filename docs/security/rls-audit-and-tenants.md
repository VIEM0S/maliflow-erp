# RLS — `audit_logs` and `tenants`

Cette note documente les politiques Row-Level Security appliquées aux tables
critiques `public.audit_logs` et `public.tenants`, ainsi que la procédure de
vérification manuelle.

## `public.audit_logs`

RLS activée. `GRANT SELECT, INSERT` accordés au rôle `authenticated`
uniquement ; `anon` explicitement révoqué.

### `audit_select_owner` (SELECT, `authenticated`)

```sql
USING (
  (tenant_id IS NULL AND is_super_admin(auth.uid()))
  OR (tenant_id IS NOT NULL AND has_tenant_role(auth.uid(), tenant_id, 'owner'))
  OR (tenant_id IS NOT NULL AND is_super_admin(auth.uid()))
)
```

Autorise :
- les super-admins à lire toutes les entrées (globales et tenant),
- le propriétaire d'un tenant à lire uniquement ses propres entrées.

Refuse tout autre rôle (`manager`, `cashier`) même si membre actif — le
journal reste strictement confidentiel au sein d'un tenant.

### `audit_insert_member` (INSERT, `authenticated`)

```sql
WITH CHECK (
  user_id = auth.uid()
  AND auth.uid() IS NOT NULL
  AND (tenant_id IS NULL OR is_tenant_member(auth.uid(), tenant_id))
)
```

Tout membre actif d'un tenant peut écrire une entrée pour son propre
`user_id` — nécessaire pour tracer les actions produit / stock / preset.
Un utilisateur ne peut jamais insérer une entrée « au nom d'autrui ».

### Contrôle applicatif complémentaire

La route `/permissions` masque le journal aux non-propriétaires
(`canSeeAudit`). Les server functions `listPresetAudit` et
`getPresetAuditDetail` (`src/lib/audit.functions.ts`) revérifient le rôle
côté serveur via `requireSupabaseAuth` et, en cas de refus, écrivent une
entrée `audit.access_denied.<action>` via le client admin avec le
`user_id`, le `tenant_id` et le contexte de tentative — même si l'appelant
ne dispose d'aucun droit INSERT sur la table.

## `public.tenants`

### `tenants_insert_self` (INSERT, `authenticated`)

```sql
WITH CHECK (created_by = auth.uid() AND auth.uid() IS NOT NULL)
```

Verrouille la création d'un tenant à l'utilisateur connecté : `created_by`
doit correspondre exactement à `auth.uid()`. Aucun appel anonyme n'est
possible (rôle `authenticated` uniquement + garde explicite `auth.uid() IS
NOT NULL`).

### `tenants_select_member` (SELECT) et `tenants_update_owner` (UPDATE)

Un utilisateur ne voit un tenant que s'il en est membre actif (ou
super-admin). Seul un propriétaire (ou super-admin) peut mettre à jour ses
métadonnées.

## Procédure de vérification `auth.uid() == created_by`

À exécuter après tout changement du flux d'onboarding, via
`supabase--read_query` :

```sql
-- 1. Aucun tenant ne doit avoir created_by NULL
SELECT count(*) AS orphan_tenants FROM public.tenants WHERE created_by IS NULL;

-- 2. Le créateur doit être membre owner actif du tenant qu'il a créé
SELECT t.id, t.name, t.created_by
FROM public.tenants t
LEFT JOIN public.memberships m
  ON m.tenant_id = t.id
 AND m.user_id = t.created_by
 AND m.role = 'owner'
 AND m.is_active = true
WHERE m.id IS NULL;
-- Résultat attendu : 0 ligne

-- 3. Test négatif : insérer un tenant avec created_by ≠ auth.uid()
--    doit échouer avec « new row violates row-level security policy ».
--    Voir tests/rls/audit-tenant-isolation.sql (scénario T3).
```

Voir `tests/rls/audit-tenant-isolation.sql` pour la batterie complète de
tests d'isolation multi-tenant.

## Fix RLS `tenants` — écriture côté serveur

La création d'un tenant passe désormais par la server function
`createTenant` (`src/lib/tenants.functions.ts`), protégée par
`requireSupabaseAuth`. La valeur `created_by` est renseignée à partir de
`context.userId` (le `sub` du JWT vérifié par le middleware) et jamais
depuis le body — impossible pour l'appelant de forger un autre
propriétaire. Cette bascule élimine la classe d'erreurs :

> `new row violates row-level security policy for table "tenants"`

qui apparaissait quand la session Supabase du navigateur était partielle
ou expirée : `auth.uid()` valait alors `NULL` côté PostgREST et la
politique `tenants_insert_self` refusait l'insert. Le membership `owner`
et le store par défaut sont provisionnés dans la même server function
pour garantir la cohérence du tenant.

## Index et budget de performance

Migration `..._audit_perf_indexes.sql` ajoute :

- `idx_audit_logs_tenant_created (tenant_id, created_at DESC)` — liste
  paginée par tenant, tri par défaut.
- `idx_audit_logs_tenant_action (tenant_id, action)` — filtre
  `actionFilter`.
- `idx_audit_logs_tenant_entity_created (tenant_id, entity, created_at
  DESC)` — liste restreinte à l'entité preset.
- `idx_audit_logs_preset_name ((metadata->>'preset_name')) WHERE entity
  = 'inventory_permission_preset'` — recherche `ilike` sur le nom de
  preset (index partiel, très compact).

Les scénarios **T8.1 → T8.4** de
`tests/rls/audit-tenant-isolation.sql` vérifient l'existence des index,
forcent un `EXPLAIN` sur les chemins critiques et posent un garde-fou
de performance (< 100 ms / 10k lignes en cache chaud).

## Tests d'entrée (validation Zod)

`tests/unit/audit-input-validation.mjs` (à lancer via `node`) prouve
que les paramètres exposés côté client à `listPresetAudit` /
`getPresetAuditDetail` — `tenantId`, `id`, `search`, `actionFilter`,
`sortBy`, `sortDir`, `page`, `pageSize` — sont strictement validés :

- `actionFilter` restreint à l'allow-list (`all|create|update|delete|apply`)
  → aucune injection possible via `?actionFilter=preset.update;--`.
- `sortBy` / `sortDir` restreints à des enums → aucun tri arbitraire.
- `search` capé à 120 caractères et trimé.
- `tenantId` / `id` doivent être des UUID valides → tentative de
  probing cross-tenant via query-string rejetée avant la RLS.

## Recherche côté serveur (audit)

La server function `listPresetAudit` (`src/lib/audit.functions.ts`)
accepte deux filtres appliqués **avant** la pagination et le tri, tout
en conservant les vérifications RLS et `assertAuditAccess` :

- `search` : texte libre (`ilike %q%`) sur `action` ou
  `metadata->>preset_name`.
- `actionFilter` : `all | create | update | delete | apply` — mappé sur
  `action = 'preset.<x>'`.

Les filtres sont exécutés côté PostgREST via une requête paramétrée
(`.or(...)`, `.eq(...)`) ; ils ne remplacent ni ne contournent les
politiques `audit_select_owner`.

## Isolation du détail (drawer)

`getPresetAuditDetail` filtre **toujours** par `id` **et** `tenant_id`.
Le scénario T6 (`tests/rls/audit-tenant-isolation.sql`) vérifie qu'un
propriétaire du tenant A qui injecte l'ID d'un audit du tenant B
(récupéré hors-bande) reçoit 0 ligne : la RLS masque déjà la ligne, et
la garde applicative `.eq("tenant_id", tenantId)` fournit une
défense en profondeur.