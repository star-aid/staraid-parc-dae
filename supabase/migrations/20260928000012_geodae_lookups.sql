-- ============================================================
-- Migration 12 : résultats de recherche Géo'DAE conservés par DAE
--
-- Étape 2 du cahier des charges, brique 2 : le dernier résultat de recherche
-- d'identifiant (trouvé, ambigu, introuvable, erreur) est conservé par DAE.
-- La page Contrôle Géo'DAE le recharge à l'ouverture, les identifiants trouvés
-- restent « à valider » d'une session à l'autre, et le futur cron sait quels
-- DAE contrôler en priorité (jamais contrôlés, puis les plus anciens).
-- Une ligne par DAE (compte + identifiant Synchroteam), remplacée à chaque contrôle.
-- Additive : ne modifie aucune table existante.
-- ============================================================

CREATE TABLE IF NOT EXISTS geodae_lookups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account           TEXT NOT NULL,                   -- REU / MYT / GLP
  synchroteam_id    TEXT NOT NULL,                   -- identifiant brut de l'équipement Synchroteam
  defibrillator_id  UUID REFERENCES defibrillators(id) ON DELETE SET NULL, -- copie locale, si connue
  serial_number     TEXT,
  status            TEXT NOT NULL CHECK (status IN ('trouve', 'ambigu', 'introuvable', 'erreur')),
  geodae_gid        TEXT,                            -- identifiant retenu quand la correspondance est unique
  candidates        JSONB NOT NULL DEFAULT '[]'::jsonb, -- correspondances renvoyées par les sources
  sources           JSONB,                           -- état des sources interrogées (open data, API exploitants)
  error             TEXT,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_by        TEXT,                            -- identifiant de l'utilisateur, ou 'cron'
  run_id            UUID REFERENCES geodae_reconciliation_runs(id) ON DELETE SET NULL,
  reported_at       TIMESTAMPTZ,                     -- renseigné quand l'identifiant a été reporté dans Synchroteam
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account, synchroteam_id)
);

CREATE INDEX IF NOT EXISTS idx_geodae_lookups_status  ON geodae_lookups(status);
CREATE INDEX IF NOT EXISTS idx_geodae_lookups_checked ON geodae_lookups(checked_at);
CREATE INDEX IF NOT EXISTS idx_geodae_lookups_serial  ON geodae_lookups(serial_number);

-- Sécurité par ligne : même convention que le journal (migration 9)
ALTER TABLE geodae_lookups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "geodae_lookups_read"          ON geodae_lookups;
DROP POLICY IF EXISTS "geodae_lookups_write_service" ON geodae_lookups;

CREATE POLICY "geodae_lookups_read"
  ON geodae_lookups FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'administrateur', 'maintenance'));

CREATE POLICY "geodae_lookups_write_service"
  ON geodae_lookups FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Droits explicites : les privilèges par défaut du projet n'en donnent aucun
-- au rôle service sur une table nouvelle (cf. migration 10).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE geodae_lookups TO service_role;
