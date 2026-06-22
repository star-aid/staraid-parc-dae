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

## Fonctions RPC disponibles

```sql
SELECT get_park_summary();                          -- KPIs dashboard + contexte IA
SELECT * FROM get_map_markers('REU', 'critique');   -- Marqueurs carte filtrés
SELECT * FROM get_interventions_monthly(12);        -- Interventions 12 mois glissants
```
