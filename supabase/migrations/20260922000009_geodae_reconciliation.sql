-- ============================================================
-- Migration 9 : journal du contrôle de cohérence Synchroteam ↔ Géo'DAE
--
-- Répond à l'étape 2 du cahier des charges (« journaliser l'absence pour le
-- rapport d'anomalies ») et pose le socle de l'étape 3 (rapport d'anomalies).
-- Additive : ne modifie aucune table existante.
--
-- À appliquer après la migration 8 :
--   Supabase Dashboard > SQL Editor > coller ce fichier > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. Exécutions du contrôle : une ligne par recherche groupée
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geodae_reconciliation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  triggered_by  TEXT,                       -- identifiant de l'utilisateur, ou 'cron'
  scope         TEXT,                       -- périmètre lisible (compte, filtre, nombre de DAE)
  examined      INTEGER NOT NULL DEFAULT 0, -- DAE examinés
  found         INTEGER NOT NULL DEFAULT 0, -- identifiant retrouvé, correspondance unique
  ambiguous     INTEGER NOT NULL DEFAULT 0, -- plusieurs correspondances
  not_found     INTEGER NOT NULL DEFAULT 0, -- introuvable dans Géo'DAE
  errors        INTEGER NOT NULL DEFAULT 0, -- source injoignable
  sources       JSONB,                      -- état des sources interrogées (open data, API exploitants)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geodae_runs_started ON geodae_reconciliation_runs(started_at DESC);

-- ------------------------------------------------------------
-- 2. Anomalies : une ligne par DAE et par type, rouverte à chaque détection,
--    fermée quand elle disparaît (resolved_at). Les types couvrent les trois
--    cas du cahier des charges plus les deux issus de la recherche elle-même.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geodae_anomalies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  UUID REFERENCES geodae_reconciliation_runs(id) ON DELETE SET NULL,
  type                    TEXT NOT NULL CHECK (type IN (
                            'absent_geodae',            -- DAE Synchroteam introuvable dans Géo'DAE
                            'ambigu',                   -- plusieurs DAE Géo'DAE pour un n° de série
                            'erreur_recherche',         -- source injoignable lors du contrôle
                            'divergence_id',            -- identifiant Synchroteam ≠ gid Géo'DAE
                            'non_reference_synchroteam' -- DAE Géo'DAE absent de Synchroteam
                          )),
  account                 TEXT,             -- REU / MYT / GLP
  synchroteam_id          TEXT,             -- identifiant brut de l'équipement Synchroteam
  defibrillator_id        UUID REFERENCES defibrillators(id) ON DELETE SET NULL, -- copie locale, si connue
  serial_number           TEXT,
  synchroteam_geo_dae_id  TEXT,             -- valeur présente dans Synchroteam au moment du contrôle
  geodae_gid              TEXT,             -- identifiant côté Géo'DAE quand il est connu
  details                 JSONB,            -- candidats, nom déclaré, message d'erreur…
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at             TIMESTAMPTZ,
  resolution              TEXT,
  -- Clé d'unicité calculée : un DAE Synchroteam est identifié par compte + id,
  -- un DAE uniquement Géo'DAE par son gid. Sert de cible aux upserts.
  anomaly_key             TEXT GENERATED ALWAYS AS (
                            type || ':' || COALESCE(account, '') || ':' || COALESCE(synchroteam_id, geodae_gid, '')
                          ) STORED,
  UNIQUE (anomaly_key)
);

CREATE INDEX IF NOT EXISTS idx_geodae_anomalies_open   ON geodae_anomalies(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_geodae_anomalies_type   ON geodae_anomalies(type);
CREATE INDEX IF NOT EXISTS idx_geodae_anomalies_serial ON geodae_anomalies(serial_number);
CREATE INDEX IF NOT EXISTS idx_geodae_anomalies_run    ON geodae_anomalies(run_id);

-- ------------------------------------------------------------
-- 3. Sécurité par ligne : lecture pour les rôles de pilotage, écriture
--    réservée au rôle service (l'application écrit toujours via ce rôle).
--    Les deux vocabulaires de rôles présents dans le projet sont acceptés.
-- ------------------------------------------------------------
ALTER TABLE geodae_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE geodae_anomalies           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "geodae_runs_read"          ON geodae_reconciliation_runs;
DROP POLICY IF EXISTS "geodae_runs_write_service" ON geodae_reconciliation_runs;
DROP POLICY IF EXISTS "geodae_anomalies_read"          ON geodae_anomalies;
DROP POLICY IF EXISTS "geodae_anomalies_write_service" ON geodae_anomalies;

CREATE POLICY "geodae_runs_read"
  ON geodae_reconciliation_runs FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'administrateur', 'maintenance'));

CREATE POLICY "geodae_runs_write_service"
  ON geodae_reconciliation_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "geodae_anomalies_read"
  ON geodae_anomalies FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'administrateur', 'maintenance'));

CREATE POLICY "geodae_anomalies_write_service"
  ON geodae_anomalies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
