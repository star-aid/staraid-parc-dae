# Prompt Claude Code — Dashboard parc DAE STAR aid

## Contexte métier

Tu codes une application web de suivi en temps réel du parc de défibrillateurs (DAE) pour la société **STAR aid** (Saint-Denis, La Réunion), spécialisée dans la maintenance, location et vente de défibrillateurs sur les territoires ultramarins (La Réunion, Mayotte, Guadeloupe).

L'objectif est de centraliser la vision du parc installé à partir des données de l'API Synchroteam (outil de gestion d'interventions terrain) et de l'API Axonaut (CRM), avec un agent IA embarqué pour l'analyse.

---

## Stack technique imposée

| Couche | Technologie |
|--------|-------------|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Base de données | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Déploiement | Vercel |
| Versionning | GitHub |
| API source principale | Synchroteam REST API v3 (lecture seule) |
| API CRM | Axonaut REST API (lecture seule) |
| Agent IA | Anthropic API — claude-sonnet-4-6 |
| Cartes | Leaflet.js |
| Graphiques | Recharts |

---

## Architecture générale

```
/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Sidebar + header
│   │   ├── page.tsx                # Vue principale KPIs
│   │   ├── parc/page.tsx           # Tableau + carte
│   │   ├── parc/[id]/page.tsx      # Fiche DAE détail
│   │   ├── alertes/page.tsx        # Vue alertes
│   │   └── analyse/page.tsx        # Agent IA
│   └── api/
│       ├── sync/synchroteam/route.ts   # Sync Synchroteam → Supabase
│       ├── sync/axonaut/route.ts       # Sync Axonaut → Supabase
│       └── ai/analyse/route.ts         # Appel Claude Sonnet
├── lib/
│   ├── synchroteam.ts              # Client API Synchroteam
│   ├── axonaut.ts                  # Client API Axonaut
│   ├── supabase.ts                 # Client Supabase
│   ├── anthropic.ts                # Client Anthropic
│   └── status.ts                   # Logique calcul statuts DAE
├── components/
│   ├── dashboard/
│   ├── map/
│   ├── table/
│   ├── charts/
│   └── ai/
└── types/
    └── index.ts                    # Types TypeScript globaux
```

---

## Synchroteam API v3 — Spécifications techniques

### Authentification

L'API Synchroteam utilise **HTTP Basic Authentication**.
Le header doit être : `Authorization: Basic <base64(domain:api-key)>`

- `domain` : identifiant du domaine STAR aid (ex: `staraid` si l'URL est `staraid.synchroteam.com`)
- `api-key` : clé API disponible dans Configuration > Authentication Key

```typescript
// lib/synchroteam.ts
const credentials = Buffer.from(`${process.env.SYNCHROTEAM_DOMAIN}:${process.env.SYNCHROTEAM_API_KEY}`).toString('base64')
const headers = {
  'Authorization': `Basic ${credentials}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}
```

### Endpoint de base

```
https://ws.synchroteam.com
```

### Variables d'environnement (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Synchroteam
SYNCHROTEAM_DOMAIN=           # ex: staraid (sans .synchroteam.com)
SYNCHROTEAM_API_KEY=
SYNCHROTEAM_BASE_URL=https://ws.synchroteam.com

# Axonaut
AXONAUT_API_KEY=
AXONAUT_BASE_URL=https://axonaut.com/api/v2

# Anthropic
ANTHROPIC_API_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=
```

### Endpoints à utiliser

| Ressource | Méthode | Endpoint | Usage |
|-----------|---------|----------|-------|
| Équipements (DAE) | GET | `/api/v3/equipment/list` | Liste complète du parc |
| Équipement détail | GET | `/api/v3/equipment/details?id={id}` | Fiche DAE |
| Clients | GET | `/api/v3/customer/list` | Clients associés |
| Sites | GET | `/api/v3/site/list` | Sites avec GPS |
| Interventions | GET | `/api/v3/job/list` | Historique interventions |
| Contrats | GET | `/api/v3/contract/list` | Contrats de maintenance |
| Techniciens | GET | `/api/v3/user/list` | Équipe technique |
| Custom fields def | GET | `/api/v3/customfield/list?type=equipment` | Structure champs DAE |

### Pagination

Tous les endpoints liste retournent :
```json
{
  "page": 1,
  "pageSize": 25,
  "records": 25,
  "recordsTotal": 452,
  "data": [...]
}
```

Utilise `pageSize=100` (maximum autorisé) et itère sur toutes les pages jusqu'à `page * pageSize >= recordsTotal`.

```typescript
async function fetchAllPages<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const url = new URL(`${process.env.SYNCHROTEAM_BASE_URL}${endpoint}`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', '100')
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), { headers })
    if (!res.ok) throw new Error(`Synchroteam API error: ${res.status}`)

    const data = await res.json()
    results.push(...data.data)

    hasMore = results.length < data.recordsTotal
    page++
  }

  return results
}
```

### Rate limits

- 1 000 requêtes/minute
- Quota journalier exposé dans les headers `X-Quota-Remaining`
- Sur erreur 429 : attendre `X-RateLimit-Reset` (timestamp UTC Unix) puis réessayer

### Custom fields équipements — ÉTAPE CRITIQUE

**Avant tout développement du pipeline de sync**, faire un appel exploratoire :

```
GET /api/v3/customfield/list?type=equipment
```

Les champs spécifiques DAE (date batterie, date électrodes, N° série, modèle, etc.) sont configurés en custom fields dans le back-office STAR aid. La structure réelle est inconnue jusqu'à cet appel. Le mapping vers Supabase doit se faire sur les `label` retournés, pas sur des IDs hardcodés.

Exemple de réponse attendue :
```json
{
  "data": [
    { "id": 101, "label": "Date expiration batterie", "type": "date" },
    { "id": 102, "label": "Date expiration électrodes", "type": "date" },
    { "id": 103, "label": "Numéro de série", "type": "text" }
  ]
}
```

Stocker le mapping `label → id` dans une table `custom_field_mapping` en Supabase pour le rendre configurable.

---

## Schéma de base de données Supabase

```sql
-- Territoires
CREATE TABLE territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,    -- 'REU', 'MYT', 'GLP'
  timezone TEXT NOT NULL,       -- 'Indian/Reunion', 'Indian/Mayotte', 'America/Guadeloupe'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO territories (name, code, timezone) VALUES
  ('La Réunion', 'REU', 'Indian/Reunion'),
  ('Mayotte', 'MYT', 'Indian/Mayotte'),
  ('Guadeloupe', 'GLP', 'America/Guadeloupe');

-- Mapping custom fields Synchroteam (configurable)
CREATE TABLE custom_field_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_field_id INTEGER UNIQUE NOT NULL,
  synchroteam_label TEXT NOT NULL,
  internal_field TEXT NOT NULL,   -- 'battery_expiry', 'electrodes_expiry', 'serial_number', etc.
  field_type TEXT NOT NULL,       -- 'date', 'text', 'number'
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clients (sync Synchroteam customers + enrichissement Axonaut)
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id TEXT UNIQUE,
  axonaut_id TEXT,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  territory_id UUID REFERENCES territories(id),
  contact_email TEXT,
  contact_phone TEXT,
  tags TEXT[],
  active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites (sync Synchroteam sites)
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id TEXT UNIQUE NOT NULL,
  client_id UUID REFERENCES clients(id),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  territory_id UUID REFERENCES territories(id),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Équipements DAE (sync Synchroteam equipment)
CREATE TABLE defibrillators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id TEXT UNIQUE NOT NULL,
  serial_number TEXT,
  model TEXT,
  brand TEXT,
  client_id UUID REFERENCES clients(id),
  site_id UUID REFERENCES sites(id),
  territory_id UUID REFERENCES territories(id),
  -- Statut calculé
  status TEXT NOT NULL DEFAULT 'inconnu',
    -- 'conforme' | 'vigilance' | 'critique' | 'inconnu'
  status_reason TEXT,             -- raison lisible du statut
  -- Dates clés (extraites des custom fields Synchroteam)
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  battery_expiry DATE,
  electrodes_expiry DATE,
  -- Statuts consommables calculés
  battery_status TEXT DEFAULT 'inconnu',      -- 'ok' | 'a_remplacer' | 'expire' | 'inconnu'
  electrodes_status TEXT DEFAULT 'inconnu',
  -- Données brutes custom fields (JSON pour flexibilité)
  custom_fields JSONB,
  -- Contrat (sync Synchroteam contracts)
  contract_type TEXT,
  contract_start DATE,
  contract_end DATE,
  notes TEXT,
  active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Interventions (sync Synchroteam jobs)
CREATE TABLE interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id TEXT UNIQUE NOT NULL,
  defibrillator_id UUID REFERENCES defibrillators(id),
  site_id UUID REFERENCES sites(id),
  client_id UUID REFERENCES clients(id),
  type TEXT,                    -- 'maintenance', 'depannage', 'installation', 'autre'
  status TEXT,                  -- 'planifie', 'en_cours', 'termine', 'annule'
  scheduled_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  technician_name TEXT,
  technician_synchroteam_id TEXT,
  duration_minutes INTEGER,
  report TEXT,
  custom_fields JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Techniciens (sync Synchroteam users)
CREATE TABLE technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  login TEXT,
  email TEXT,
  territory_id UUID REFERENCES territories(id),
  active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMPTZ
);

-- Logs de synchronisation
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- Index
CREATE INDEX idx_dae_territory ON defibrillators(territory_id);
CREATE INDEX idx_dae_client ON defibrillators(client_id);
CREATE INDEX idx_dae_site ON defibrillators(site_id);
CREATE INDEX idx_dae_status ON defibrillators(status);
CREATE INDEX idx_dae_next_maintenance ON defibrillators(next_maintenance_date);
CREATE INDEX idx_dae_battery_expiry ON defibrillators(battery_expiry);
CREATE INDEX idx_dae_electrodes_expiry ON defibrillators(electrodes_expiry);
CREATE INDEX idx_interventions_dae ON interventions(defibrillator_id);
CREATE INDEX idx_interventions_date ON interventions(scheduled_date);
CREATE INDEX idx_sites_territory ON sites(territory_id);
CREATE INDEX idx_clients_territory ON clients(territory_id);
```

---

## Module — Logique de calcul des statuts (`lib/status.ts`)

```typescript
export type DAEStatus = 'conforme' | 'vigilance' | 'critique' | 'inconnu'

export function computeDAEStatus(dae: {
  next_maintenance_date: Date | null
  battery_expiry: Date | null
  electrodes_expiry: Date | null
}): { status: DAEStatus; reason: string } {
  const today = new Date()
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Données insuffisantes
  if (!dae.next_maintenance_date && !dae.battery_expiry && !dae.electrodes_expiry) {
    return { status: 'inconnu', reason: 'Données insuffisantes' }
  }

  // Critique : échéance dépassée
  if (dae.next_maintenance_date && dae.next_maintenance_date < today) {
    return { status: 'critique', reason: 'Maintenance échue' }
  }
  if (dae.battery_expiry && dae.battery_expiry < today) {
    return { status: 'critique', reason: 'Batterie expirée' }
  }
  if (dae.electrodes_expiry && dae.electrodes_expiry < today) {
    return { status: 'critique', reason: 'Électrodes expirées' }
  }

  // Vigilance : échéance dans < 30 jours
  if (dae.next_maintenance_date && dae.next_maintenance_date <= in30Days) {
    return { status: 'vigilance', reason: 'Maintenance dans moins de 30 jours' }
  }
  if (dae.battery_expiry && dae.battery_expiry <= in30Days) {
    return { status: 'vigilance', reason: 'Batterie expire dans moins de 30 jours' }
  }
  if (dae.electrodes_expiry && dae.electrodes_expiry <= in30Days) {
    return { status: 'vigilance', reason: 'Électrodes expirent dans moins de 30 jours' }
  }

  return { status: 'conforme', reason: 'Tout à jour' }
}
```

---

## Pipeline de synchronisation (`app/api/sync/synchroteam/route.ts`)

Route POST protégée par header `x-cron-secret: ${CRON_SECRET}`.

### Ordre d'exécution obligatoire (contraintes de clés étrangères)

1. **Discovery** : `GET /api/v3/customfield/list?type=equipment` → mise à jour `custom_field_mapping`
2. **Clients** : `GET /api/v3/customer/list` → upsert `clients` sur `synchroteam_id`
3. **Sites** : `GET /api/v3/site/list` → upsert `sites` sur `synchroteam_id`, rattacher au client
4. **Techniciens** : `GET /api/v3/user/list` → upsert `technicians`
5. **Équipements** : `GET /api/v3/equipment/list` → upsert `defibrillators`, extraire custom fields selon mapping
6. **Contrats** : `GET /api/v3/contract/list` → enrichir `defibrillators.contract_*`
7. **Interventions** : `GET /api/v3/job/list` (12 derniers mois) → upsert `interventions`
8. **Calcul statuts** : pour chaque DAE mis à jour, recalculer `status` et `status_reason`
9. **Géocodage fallback** : pour les sites sans coordonnées GPS, appel Nominatim

### Détection du territoire

Synchroteam ne gère pas nativement les territoires STAR aid. Implémenter une heuristique sur l'adresse :
```typescript
function detectTerritory(address: string): string {
  const lower = address.toLowerCase()
  if (lower.includes('réunion') || lower.includes('reunion') || lower.includes('974')) return 'REU'
  if (lower.includes('mayotte') || lower.includes('976')) return 'MYT'
  if (lower.includes('guadeloupe') || lower.includes('971')) return 'GLP'
  return 'REU' // défaut
}
```

### Cron Vercel (`vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/sync/synchroteam",
      "schedule": "0 * * * *"
    }
  ]
}
```

---

## Pages frontend

### Layout dashboard (`app/(dashboard)/layout.tsx`)

Sidebar navigation :
- Logo STAR aid + "Parc DAE"
- Items : Tableau de bord, Parc DAE, Alertes (badge rouge = nb DAE critiques), Analyse IA
- Footer : timestamp dernière sync + bouton "Synchroniser maintenant"

### Page KPIs (`app/(dashboard)/page.tsx`)

4 metric cards : total DAE, % conformes, nb vigilance (fond amber), nb critiques (fond rouge)

Graphiques :
- Donut : répartition statuts
- Barres groupées : DAE par territoire × statut
- Ligne : interventions réalisées sur 12 mois glissants
- Tableau : 5 prochaines échéances (DAE, client, date, territoire, raison)

### Page parc DAE (`app/(dashboard)/parc/page.tsx`)

**Vue duale toggle : tableau / carte**

Tableau :
- Colonnes : N° série, Modèle, Client, Site, Territoire, Statut (badge coloré), Dernière maintenance, Prochaine échéance, Batterie, Électrodes, Actions
- Filtres : territoire (multi-select), statut (multi-select), recherche texte libre
- Tri sur toutes colonnes
- Pagination 50/page
- Export CSV

Carte Leaflet :
- `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- Marqueurs couleur : vert (conforme), orange (vigilance), rouge (critique), gris (inconnu)
- Clustering automatique (`leaflet.markercluster`)
- Popup au clic : nom site, client, statut + raison, prochaine échéance, lien fiche
- Centre par défaut : La Réunion (-21.1, 55.5), zoom 10

### Fiche DAE (`app/(dashboard)/parc/[id]/page.tsx`)

- En-tête : modèle, marque, N° série, badge statut, raison statut
- Consommables : batterie (date + barre de progression vers expiry), électrodes (idem)
- Maintenance : dernière date, prochaine date, technicien assigné
- Contrat : type, début, fin
- Mini-carte Leaflet centrée sur le site
- Historique interventions : tableau chronologique (date, type, technicien, statut, rapport)

### Page alertes (`app/(dashboard)/alertes/page.tsx`)

Filtre automatique sur `status IN ('critique', 'vigilance')`, triés par urgence (critique en premier, puis date échéance ASC).
Colonnes : DAE, raison alerte, client, territoire, prochaine échéance.
Export liste (CSV).

### Page analyse IA (`app/(dashboard)/analyse/page.tsx`)

Interface chat avec streaming SSE.

Route API `app/api/ai/analyse/route.ts` :

```typescript
// Construire le contexte parc depuis Supabase avant chaque appel
const parkSummary = await buildParkSummary() // agrégats depuis Supabase

const systemPrompt = `Tu es l'assistant IA de STAR aid, société spécialisée dans la maintenance de défibrillateurs (DAE) sur les territoires ultramarins.

État actuel du parc (données temps réel) :
${JSON.stringify(parkSummary, null, 2)}

Tes missions :
- Identifier les anomalies et risques opérationnels
- Prioriser les interventions urgentes par territoire
- Projeter les échéances à venir (30/60/90 jours)
- Analyser la charge de travail par technicien
- Répondre en français, de façon concise et orientée action

Règles strictes :
- Tu n'inventes aucune donnée
- Si une information est absente du contexte, tu le signales explicitement
- Tu cites toujours les DAE concernés par leur N° série ou nom de site`

// Utiliser claude-sonnet-4-6 avec streaming
```

Suggestions de questions prédéfinies dans l'UI :
- "Quels DAE sont les plus urgents ?"
- "Quel est le taux de conformité par territoire ?"
- "Quelles interventions planifier cette semaine ?"
- "Y a-t-il des anomalies dans les données ?"

---

## Authentification et rôles

Supabase Auth avec métadonnées utilisateur `role` :
- `dt` : accès complet toutes pages
- `technicien` : lecture seule, filtré sur territory_id de son profil
- `direction` : lecture seule, page KPIs et alertes uniquement

Middleware Next.js (`middleware.ts`) : vérifie session Supabase sur toutes routes `(dashboard)`.

Row Level Security Supabase : activer RLS sur toutes les tables, policies par rôle.

---

## Contraintes de qualité

- TypeScript strict, zéro `any`
- Gestion d'erreur exhaustive sur tous les appels API externes
- Loading states / skeletons sur toutes les données async
- Responsive mobile : pages KPIs et alertes en cards sur mobile
- Zéro donnée hardcodée : tout depuis Supabase
- Commentaires en français sur la logique métier
- Variables d'environnement : jamais de secret côté client (`NEXT_PUBLIC_` uniquement pour Supabase URL et anon key)

---

## Ordre de développement recommandé

1. Init Next.js 14 + Supabase + Tailwind + GitHub + Vercel
2. Migrations SQL Supabase (schéma complet ci-dessus)
3. **Discovery Synchroteam** : appel exploratoire `customfield/list?type=equipment` pour mapper les champs réels → alimenter `custom_field_mapping`
4. `lib/synchroteam.ts` complet avec `fetchAllPages`
5. Pipeline sync `/api/sync/synchroteam` (ordre : clients → sites → techniciens → équipements → contrats → interventions → statuts)
6. Vérifier les données en base Supabase avant de toucher au frontend
7. Layout dashboard + page KPIs
8. Page parc — tableau filtrable
9. Page parc — vue carte Leaflet
10. Fiche DAE détail
11. Page alertes
12. `lib/axonaut.ts` + `/api/sync/axonaut` (enrichissement contrats/clients)
13. Agent IA — route API streaming + interface chat
14. Auth Supabase + middleware + RLS
15. Tests, recette, déploiement Vercel production

---

## Points d'attention spécifiques

**Domain Synchroteam** : l'authentification Basic Auth nécessite le domaine du compte STAR aid (ex: `staraid`). À récupérer dans Configuration > Authentication Key dans l'interface Synchroteam.

**Custom fields** : c'est le point de risque principal. Les champs batterie, électrodes, N° série peuvent avoir des labels différents de ceux attendus. Implémenter une interface admin simple (`/admin/field-mapping`) permettant de modifier le mapping `synchroteam_label → internal_field` sans redéploiement.

**Territoire** : Synchroteam n'a pas de champ territoire natif. La détection se fait sur l'adresse. Prévoir un override manuel par DAE si la détection automatique échoue.

**GPS manquant** : pour les sites sans coordonnées, géocodage via `https://nominatim.openstreetmap.org/search?q={address}&format=json` (gratuit, max 1 req/sec — respecter le rate limit).

**Fuseaux horaires** : stocker tout en UTC. Afficher en heure locale selon `territories.timezone`.

**Performance** : utiliser `.range()` Supabase pour la pagination du tableau. Pour la carte, ne charger que les champs nécessaires aux marqueurs (id, lat, lng, statut, nom site) — pas la fiche complète.

**Contrats Synchroteam vs Axonaut** : Synchroteam a son propre objet `contract`. Commencer par exploiter les contrats Synchroteam. Axonaut intervient en enrichissement pour les données commerciales (type de contrat commercial, montant, facturation) si nécessaire.
