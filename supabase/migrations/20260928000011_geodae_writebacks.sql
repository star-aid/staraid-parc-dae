-- ============================================================
-- Migration 11 : trace des reports d'identifiant Géo'DAE vers Synchroteam
--
-- Étape 2 du cahier des charges (« faire un appel d'update vers Synchroteam
-- pour renseigner le champ correspondant »). Chaque report validé par un
-- utilisateur depuis la page Contrôle Géo'DAE laisse une ligne ici, réussi ou
-- non, pour savoir qui a écrit quoi, quand, et ce que contenait le champ avant.
-- Additive : ne modifie aucune table existante.
-- ============================================================

CREATE TABLE IF NOT EXISTS geodae_writebacks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account           TEXT,                            -- REU / MYT / GLP
  synchroteam_id    TEXT NOT NULL,                   -- identifiant brut de l'équipement Synchroteam
  defibrillator_id  UUID REFERENCES defibrillators(id) ON DELETE SET NULL, -- copie locale, si connue
  serial_number     TEXT,
  geodae_gid        TEXT NOT NULL,                   -- identifiant écrit dans Synchroteam
  previous_value    TEXT,                            -- contenu du champ avant l'écriture
  status            TEXT NOT NULL CHECK (status IN ('ok', 'erreur')),
  verified          BOOLEAN NOT NULL DEFAULT FALSE,  -- valeur relue dans Synchroteam après l'écriture
  error             TEXT,
  written_by        TEXT,                            -- identifiant de l'utilisateur ayant validé
  written_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geodae_writebacks_written ON geodae_writebacks(written_at DESC);
CREATE INDEX IF NOT EXISTS idx_geodae_writebacks_equipment ON geodae_writebacks(account, synchroteam_id);

-- Sécurité par ligne : même convention que le journal (migration 9)
ALTER TABLE geodae_writebacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "geodae_writebacks_read"          ON geodae_writebacks;
DROP POLICY IF EXISTS "geodae_writebacks_write_service" ON geodae_writebacks;

CREATE POLICY "geodae_writebacks_read"
  ON geodae_writebacks FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'administrateur', 'maintenance'));

CREATE POLICY "geodae_writebacks_write_service"
  ON geodae_writebacks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Droits explicites : les privilèges par défaut du projet n'en donnent aucun
-- au rôle service sur une table nouvelle (cf. migration 10).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE geodae_writebacks TO service_role;
