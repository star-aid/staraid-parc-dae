-- ============================================================
-- Migration 3 : Row Level Security (RLS)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Activation RLS sur toutes les tables
-- ────────────────────────────────────────────────────────────
ALTER TABLE territories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites                ENABLE ROW LEVEL SECURITY;
ALTER TABLE defibrillators       ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians          ENABLE ROW LEVEL SECURITY;
ALTER TABLE interventions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs            ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- Helper : récupère le rôle et le territoire de l'utilisateur courant
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth_user_territory()
RETURNS UUID AS $$
  SELECT territory_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ────────────────────────────────────────────────────────────
-- territories — lecture publique pour tous les authentifiés
-- ────────────────────────────────────────────────────────────
CREATE POLICY "territories_read_all"
  ON territories FOR SELECT
  TO authenticated
  USING (true);

-- ────────────────────────────────────────────────────────────
-- profiles — chaque utilisateur voit uniquement son propre profil
--            les DT voient tous les profils
-- ────────────────────────────────────────────────────────────
CREATE POLICY "profiles_read_own"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR auth_user_role() = 'dt'
  );

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- custom_field_mapping — lecture tous, écriture DT uniquement
-- ────────────────────────────────────────────────────────────
CREATE POLICY "custom_field_mapping_read"
  ON custom_field_mapping FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "custom_field_mapping_write"
  ON custom_field_mapping FOR ALL
  TO authenticated
  USING (auth_user_role() = 'dt')
  WITH CHECK (auth_user_role() = 'dt');

-- ────────────────────────────────────────────────────────────
-- clients
--   dt         : accès complet tous territoires
--   technicien : son territoire uniquement
--   direction  : lecture tous territoires
-- ────────────────────────────────────────────────────────────
CREATE POLICY "clients_read_dt_direction"
  ON clients FOR SELECT
  TO authenticated
  USING (
    auth_user_role() IN ('dt', 'direction')
  );

CREATE POLICY "clients_read_technicien"
  ON clients FOR SELECT
  TO authenticated
  USING (
    auth_user_role() = 'technicien'
    AND territory_id = auth_user_territory()
  );

CREATE POLICY "clients_write_dt"
  ON clients FOR ALL
  TO authenticated
  USING (auth_user_role() = 'dt')
  WITH CHECK (auth_user_role() = 'dt');

-- ────────────────────────────────────────────────────────────
-- sites — même logique que clients
-- ────────────────────────────────────────────────────────────
CREATE POLICY "sites_read_dt_direction"
  ON sites FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "sites_read_technicien"
  ON sites FOR SELECT
  TO authenticated
  USING (
    auth_user_role() = 'technicien'
    AND territory_id = auth_user_territory()
  );

CREATE POLICY "sites_write_dt"
  ON sites FOR ALL
  TO authenticated
  USING (auth_user_role() = 'dt')
  WITH CHECK (auth_user_role() = 'dt');

-- ────────────────────────────────────────────────────────────
-- defibrillators — même logique
-- ────────────────────────────────────────────────────────────
CREATE POLICY "dae_read_dt_direction"
  ON defibrillators FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "dae_read_technicien"
  ON defibrillators FOR SELECT
  TO authenticated
  USING (
    auth_user_role() = 'technicien'
    AND territory_id = auth_user_territory()
  );

CREATE POLICY "dae_write_dt"
  ON defibrillators FOR ALL
  TO authenticated
  USING (auth_user_role() = 'dt')
  WITH CHECK (auth_user_role() = 'dt');

-- ────────────────────────────────────────────────────────────
-- technicians
-- ────────────────────────────────────────────────────────────
CREATE POLICY "technicians_read_dt_direction"
  ON technicians FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "technicians_read_technicien"
  ON technicians FOR SELECT
  TO authenticated
  USING (
    auth_user_role() = 'technicien'
    AND territory_id = auth_user_territory()
  );

CREATE POLICY "technicians_write_dt"
  ON technicians FOR ALL
  TO authenticated
  USING (auth_user_role() = 'dt')
  WITH CHECK (auth_user_role() = 'dt');

-- ────────────────────────────────────────────────────────────
-- interventions
-- ────────────────────────────────────────────────────────────
CREATE POLICY "interventions_read_dt_direction"
  ON interventions FOR SELECT
  TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "interventions_read_technicien"
  ON interventions FOR SELECT
  TO authenticated
  USING (
    auth_user_role() = 'technicien'
    AND EXISTS (
      SELECT 1 FROM defibrillators d
      WHERE d.id = interventions.defibrillator_id
        AND d.territory_id = auth_user_territory()
    )
  );

CREATE POLICY "interventions_write_dt"
  ON interventions FOR ALL
  TO authenticated
  USING (auth_user_role() = 'dt')
  WITH CHECK (auth_user_role() = 'dt');

-- ────────────────────────────────────────────────────────────
-- sync_logs — lecture DT uniquement
-- ────────────────────────────────────────────────────────────
CREATE POLICY "sync_logs_read_dt"
  ON sync_logs FOR SELECT
  TO authenticated
  USING (auth_user_role() = 'dt');

CREATE POLICY "sync_logs_write_service"
  ON sync_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
