# Supabase — Application du schéma

## Application rapide (dashboard Supabase)

1. Ouvrir **Supabase Dashboard > SQL Editor**
2. Copier-coller le contenu de `schema.sql`
3. Cliquer **Run**

## Application par fichiers séquentiels (ordre obligatoire)

```
migrations/20260622000001_schema.sql     # Tables + index
migrations/20260622000002_triggers.sql   # updated_at + handle_new_user
migrations/20260622000003_rls.sql        # Row Level Security + helpers
migrations/20260622000004_functions.sql  # get_park_summary, get_map_markers, get_interventions_monthly
```

## Migrations depuis le poste de travail (CLI Supabase)

Équivalent de `prisma migrate deploy` : le CLI applique les fichiers de `migrations/`
non encore appliqués et les trace dans la table `supabase_migrations.schema_migrations`.

Prérequis : `SUPABASE_DB_URL` dans `.env` (chaîne « Session pooler », voir `.env.local.example`).

```bash
npm run db:status                 # état : versions locales / versions appliquées
npm run db:push -- --dry-run      # ce qui serait appliqué, sans rien exécuter
npm run db:push                   # applique les migrations en attente
```

Première utilisation sur une base créée « à la main » (SQL Editor) : marquer les
migrations déjà en place comme appliquées, sinon `db:push` tenterait de les rejouer.

```bash
npm run db:baseline -- 20260622000001 20260622000002 20260622000003 20260622000004 20260622000005 20260623000006 20260623000007
```

### Droits sur les nouvelles tables

Les privilèges par défaut du schéma `public` ont été restreints sur le projet :
une table créée par migration ne donne aucun droit de lecture ni d'écriture au rôle
`service_role` (ni à `anon` / `authenticated`). Toute migration qui crée une table
doit donc accorder explicitement les droits nécessaires, comme la migration 10 :

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ma_table TO service_role;
```

## Variables d'environnement à renseigner dans `.env.local`

Récupérables dans **Supabase Dashboard > Project Settings > API** :

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

## Créer le premier utilisateur DT

Après application du schéma, créer un utilisateur dans **Authentication > Users**, puis mettre à jour son profil :

```sql
UPDATE profiles
SET role = 'dt', full_name = 'Prénom Nom'
WHERE id = '<user-uuid>';
```

## Tables créées

| Table | Description |
|-------|-------------|
| `territories` | REU / MYT / GLP (pré-rempli) |
| `custom_field_mapping` | Mapping labels Synchroteam → champs internes |
| `profiles` | Profils utilisateurs (rôle + territoire) |
| `clients` | Clients Synchroteam + enrichissement Axonaut |
| `sites` | Sites avec coordonnées GPS |
| `defibrillators` | Parc DAE avec statuts calculés |
| `technicians` | Équipe technique |
| `interventions` | Historique interventions |
| `sync_logs` | Logs synchronisation |
| `geodae_reconciliation_runs` | Recherches groupées d'identifiants Géo'DAE (migration 9) |
| `geodae_anomalies` | Anomalies Synchroteam ↔ Géo'DAE, ouvertes / clôturées (migration 9) |
| `geodae_writebacks` | Reports d'identifiant Géo'DAE écrits dans Synchroteam, par qui et quand (migration 11) |
| `geodae_lookups` | Dernier résultat de recherche Géo'DAE par DAE : statut, candidats, date du contrôle (migration 12) |

## Fonctions RPC disponibles

```sql
SELECT get_park_summary();                          -- KPIs dashboard + contexte IA
SELECT * FROM get_map_markers('REU', 'critique');   -- Marqueurs carte filtrés
SELECT * FROM get_interventions_monthly(12);        -- Interventions 12 mois glissants
```
