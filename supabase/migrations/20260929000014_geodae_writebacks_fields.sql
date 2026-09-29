-- ============================================================
-- Migration 14 : la trace des reports vers Synchroteam devient générique
--
-- Jusqu'ici geodae_writebacks ne tracait que l'identifiant Géo'DAE. Le report
-- de la date de dernière maintenance (comparaison Synchroteam ↔ Géo'DAE)
-- utilise la même table : `field` dit quel champ a été écrit, `value` la
-- valeur écrite. Les lignes existantes gardent geodae_gid et reçoivent
-- field = 'geo_dae_id', value = geodae_gid. Additive, sans perte.
-- ============================================================

ALTER TABLE geodae_writebacks
  ADD COLUMN IF NOT EXISTS field TEXT NOT NULL DEFAULT 'geo_dae_id',
  ADD COLUMN IF NOT EXISTS value TEXT;

UPDATE geodae_writebacks SET value = geodae_gid WHERE value IS NULL;

ALTER TABLE geodae_writebacks ALTER COLUMN geodae_gid DROP NOT NULL;

ALTER TABLE geodae_writebacks
  DROP CONSTRAINT IF EXISTS geodae_writebacks_field_check,
  ADD CONSTRAINT geodae_writebacks_field_check CHECK (field IN ('geo_dae_id', 'last_maintenance_field'));

CREATE INDEX IF NOT EXISTS idx_geodae_writebacks_field ON geodae_writebacks(field, written_at DESC);
