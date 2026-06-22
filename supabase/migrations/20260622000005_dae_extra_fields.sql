-- ============================================================
-- Migration 5 : Colonnes supplémentaires defibrillators
--               issues des custom fields Synchroteam STAR aid
-- ============================================================

ALTER TABLE defibrillators
  ADD COLUMN IF NOT EXISTS manufacture_date   DATE,
  ADD COLUMN IF NOT EXISTS location_detail    TEXT,
  ADD COLUMN IF NOT EXISTS geo_dae_id         TEXT,
  ADD COLUMN IF NOT EXISTS zone_geographique  TEXT,
  ADD COLUMN IF NOT EXISTS cabinet_code       TEXT,
  ADD COLUMN IF NOT EXISTS kit_rcp            BOOLEAN,
  ADD COLUMN IF NOT EXISTS loan_serial_number TEXT,
  ADD COLUMN IF NOT EXISTS registre_star_aid  BOOLEAN;

-- Index utile pour la vue carte (zone géographique) et le registre
CREATE INDEX IF NOT EXISTS idx_dae_zone ON defibrillators(zone_geographique);
CREATE INDEX IF NOT EXISTS idx_dae_geo_id ON defibrillators(geo_dae_id);
