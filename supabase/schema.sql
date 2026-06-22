-- ============================================================
-- Schéma complet parc DAE STAR aid
-- À appliquer dans : Supabase Dashboard > SQL Editor
-- Ordre d'exécution : ce fichier unique suffit
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABLES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS territories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  code       TEXT        UNIQUE NOT NULL,
  timezone   TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO territories (name, code, timezone) VALUES
  ('La Réunion', 'REU', 'Indian/Reunion'),
  ('Mayotte',    'MYT', 'Indian/Mayotte'),
  ('Guadeloupe', 'GLP', 'America/Guadeloupe')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS custom_field_mapping (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_field_id  INTEGER UNIQUE NOT NULL,
  synchroteam_label     TEXT    NOT NULL,
  internal_field        TEXT    NOT NULL,
  field_type            TEXT    NOT NULL CHECK (field_type IN ('date', 'text', 'number')),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT  NOT NULL DEFAULT 'technicien'
                     CHECK (role IN ('dt', 'technicien', 'direction')),
  territory_id UUID  REFERENCES territories(id),
  full_name    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id   TEXT  UNIQUE,
  axonaut_id       TEXT,
  name             TEXT  NOT NULL,
  address          TEXT,
  city             TEXT,
  territory_id     UUID  REFERENCES territories(id),
  contact_email    TEXT,
  contact_phone    TEXT,
  tags             TEXT[]  DEFAULT '{}',
  active           BOOLEAN DEFAULT TRUE,
  synced_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id   TEXT  UNIQUE NOT NULL,
  client_id        UUID  REFERENCES clients(id),
  name             TEXT  NOT NULL,
  address          TEXT,
  city             TEXT,
  territory_id     UUID  REFERENCES territories(id),
  latitude         DECIMAL(10, 8),
  longitude        DECIMAL(11, 8),
  active           BOOLEAN DEFAULT TRUE,
  synced_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS defibrillators (
  id                    UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id        TEXT  UNIQUE NOT NULL,
  serial_number         TEXT,
  model                 TEXT,
  brand                 TEXT,
  client_id             UUID  REFERENCES clients(id),
  site_id               UUID  REFERENCES sites(id),
  territory_id          UUID  REFERENCES territories(id),
  status                TEXT  NOT NULL DEFAULT 'inconnu'
                              CHECK (status IN ('conforme', 'vigilance', 'critique', 'inconnu')),
  status_reason         TEXT,
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  battery_expiry        DATE,
  electrodes_expiry     DATE,
  battery_status        TEXT  DEFAULT 'inconnu'
                              CHECK (battery_status IN ('ok', 'a_remplacer', 'expire', 'inconnu')),
  electrodes_status     TEXT  DEFAULT 'inconnu'
                              CHECK (electrodes_status IN ('ok', 'a_remplacer', 'expire', 'inconnu')),
  custom_fields         JSONB,
  contract_type         TEXT,
  contract_start        DATE,
  contract_end          DATE,
  notes                 TEXT,
  active                BOOLEAN   DEFAULT TRUE,
  synced_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS technicians (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id   TEXT  UNIQUE NOT NULL,
  first_name       TEXT,
  last_name        TEXT,
  login            TEXT,
  email            TEXT,
  territory_id     UUID  REFERENCES territories(id),
  active           BOOLEAN DEFAULT TRUE,
  synced_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS interventions (
  id                        UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id            TEXT  UNIQUE NOT NULL,
  defibrillator_id          UUID  REFERENCES defibrillators(id),
  site_id                   UUID  REFERENCES sites(id),
  client_id                 UUID  REFERENCES clients(id),
  type                      TEXT  CHECK (type IN ('maintenance', 'depannage', 'installation', 'autre')),
  status                    TEXT  CHECK (status IN ('planifie', 'en_cours', 'termine', 'annule')),
  scheduled_date            TIMESTAMPTZ,
  completed_date            TIMESTAMPTZ,
  technician_name           TEXT,
  technician_synchroteam_id TEXT,
  duration_minutes          INTEGER,
  report                    TEXT,
  custom_fields             JSONB,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT  NOT NULL,
  status          TEXT  NOT NULL CHECK (status IN ('running', 'success', 'error')),
  records_synced  INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- 2. INDEX
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dae_territory         ON defibrillators(territory_id);
CREATE INDEX IF NOT EXISTS idx_dae_client            ON defibrillators(client_id);
CREATE INDEX IF NOT EXISTS idx_dae_site              ON defibrillators(site_id);
CREATE INDEX IF NOT EXISTS idx_dae_status            ON defibrillators(status);
CREATE INDEX IF NOT EXISTS idx_dae_next_maintenance  ON defibrillators(next_maintenance_date);
CREATE INDEX IF NOT EXISTS idx_dae_battery_expiry    ON defibrillators(battery_expiry);
CREATE INDEX IF NOT EXISTS idx_dae_electrodes_expiry ON defibrillators(electrodes_expiry);
CREATE INDEX IF NOT EXISTS idx_dae_active            ON defibrillators(active);
CREATE INDEX IF NOT EXISTS idx_interventions_dae     ON interventions(defibrillator_id);
CREATE INDEX IF NOT EXISTS idx_interventions_date    ON interventions(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_interventions_status  ON interventions(status);
CREATE INDEX IF NOT EXISTS idx_sites_territory       ON sites(territory_id);
CREATE INDEX IF NOT EXISTS idx_sites_client          ON sites(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_territory     ON clients(territory_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_source      ON sync_logs(source, started_at DESC);

-- ────────────────────────────────────────────────────────────
-- 3. TRIGGERS
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_defibrillators_updated_at
  BEFORE UPDATE ON defibrillators
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER set_custom_field_mapping_updated_at
  BEFORE UPDATE ON custom_field_mapping
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'technicien')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
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

-- Helpers

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth_user_territory()
RETURNS UUID AS $$
  SELECT territory_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- territories
CREATE POLICY "territories_read_all"
  ON territories FOR SELECT TO authenticated USING (true);

-- profiles
CREATE POLICY "profiles_read_own"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR auth_user_role() = 'dt');

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- custom_field_mapping
CREATE POLICY "custom_field_mapping_read"
  ON custom_field_mapping FOR SELECT TO authenticated USING (true);

CREATE POLICY "custom_field_mapping_write"
  ON custom_field_mapping FOR ALL TO authenticated
  USING (auth_user_role() = 'dt') WITH CHECK (auth_user_role() = 'dt');

-- clients
CREATE POLICY "clients_read_dt_direction"
  ON clients FOR SELECT TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "clients_read_technicien"
  ON clients FOR SELECT TO authenticated
  USING (auth_user_role() = 'technicien' AND territory_id = auth_user_territory());

CREATE POLICY "clients_write_dt"
  ON clients FOR ALL TO authenticated
  USING (auth_user_role() = 'dt') WITH CHECK (auth_user_role() = 'dt');

-- sites
CREATE POLICY "sites_read_dt_direction"
  ON sites FOR SELECT TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "sites_read_technicien"
  ON sites FOR SELECT TO authenticated
  USING (auth_user_role() = 'technicien' AND territory_id = auth_user_territory());

CREATE POLICY "sites_write_dt"
  ON sites FOR ALL TO authenticated
  USING (auth_user_role() = 'dt') WITH CHECK (auth_user_role() = 'dt');

-- defibrillators
CREATE POLICY "dae_read_dt_direction"
  ON defibrillators FOR SELECT TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "dae_read_technicien"
  ON defibrillators FOR SELECT TO authenticated
  USING (auth_user_role() = 'technicien' AND territory_id = auth_user_territory());

CREATE POLICY "dae_write_dt"
  ON defibrillators FOR ALL TO authenticated
  USING (auth_user_role() = 'dt') WITH CHECK (auth_user_role() = 'dt');

-- technicians
CREATE POLICY "technicians_read_dt_direction"
  ON technicians FOR SELECT TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "technicians_read_technicien"
  ON technicians FOR SELECT TO authenticated
  USING (auth_user_role() = 'technicien' AND territory_id = auth_user_territory());

CREATE POLICY "technicians_write_dt"
  ON technicians FOR ALL TO authenticated
  USING (auth_user_role() = 'dt') WITH CHECK (auth_user_role() = 'dt');

-- interventions
CREATE POLICY "interventions_read_dt_direction"
  ON interventions FOR SELECT TO authenticated
  USING (auth_user_role() IN ('dt', 'direction'));

CREATE POLICY "interventions_read_technicien"
  ON interventions FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'technicien'
    AND EXISTS (
      SELECT 1 FROM defibrillators d
      WHERE d.id = interventions.defibrillator_id
        AND d.territory_id = auth_user_territory()
    )
  );

CREATE POLICY "interventions_write_dt"
  ON interventions FOR ALL TO authenticated
  USING (auth_user_role() = 'dt') WITH CHECK (auth_user_role() = 'dt');

-- sync_logs
CREATE POLICY "sync_logs_read_dt"
  ON sync_logs FOR SELECT TO authenticated
  USING (auth_user_role() = 'dt');

CREATE POLICY "sync_logs_write_service"
  ON sync_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 5. FONCTIONS UTILITAIRES
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_park_summary()
RETURNS JSON AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'total',       COUNT(*),
    'conforme',    COUNT(*) FILTER (WHERE status = 'conforme'),
    'vigilance',   COUNT(*) FILTER (WHERE status = 'vigilance'),
    'critique',    COUNT(*) FILTER (WHERE status = 'critique'),
    'inconnu',     COUNT(*) FILTER (WHERE status = 'inconnu'),
    'by_territory', (
      SELECT json_object_agg(t.code, json_build_object(
        'total',     COUNT(d.id),
        'conforme',  COUNT(d.id) FILTER (WHERE d.status = 'conforme'),
        'vigilance', COUNT(d.id) FILTER (WHERE d.status = 'vigilance'),
        'critique',  COUNT(d.id) FILTER (WHERE d.status = 'critique'),
        'inconnu',   COUNT(d.id) FILTER (WHERE d.status = 'inconnu')
      ))
      FROM territories t
      LEFT JOIN defibrillators d ON d.territory_id = t.id AND d.active = true
      GROUP BY t.code
    ),
    'next_expirations', (
      SELECT json_agg(sub ORDER BY sub.next_date)
      FROM (
        SELECT d.id, d.serial_number, d.model,
               c.name AS client_name, t.code AS territory_code,
               LEAST(d.next_maintenance_date, d.battery_expiry, d.electrodes_expiry)::TEXT AS next_date,
               d.status_reason AS reason
        FROM defibrillators d
        LEFT JOIN clients c ON c.id = d.client_id
        LEFT JOIN territories t ON t.id = d.territory_id
        WHERE d.active = true
          AND d.status IN ('critique', 'vigilance')
          AND LEAST(d.next_maintenance_date, d.battery_expiry, d.electrodes_expiry) IS NOT NULL
        ORDER BY next_date LIMIT 10
      ) sub
    ),
    'last_sync', (
      SELECT finished_at::TEXT FROM sync_logs
      WHERE source = 'synchroteam' AND status = 'success'
      ORDER BY finished_at DESC LIMIT 1
    )
  )
  INTO result
  FROM defibrillators WHERE active = true;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_map_markers(
  p_territory_code TEXT DEFAULT NULL,
  p_status         TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, latitude DECIMAL, longitude DECIMAL,
  status TEXT, status_reason TEXT,
  site_name TEXT, client_name TEXT,
  serial_number TEXT, model TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, s.latitude, s.longitude, d.status, d.status_reason,
         s.name, c.name, d.serial_number, d.model
  FROM defibrillators d
  JOIN sites s       ON s.id = d.site_id
  JOIN clients c     ON c.id = d.client_id
  JOIN territories t ON t.id = d.territory_id
  WHERE d.active = true
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND (p_territory_code IS NULL OR t.code = p_territory_code)
    AND (p_status IS NULL OR d.status = p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_interventions_monthly(p_months INTEGER DEFAULT 12)
RETURNS TABLE (month TEXT, total BIGINT, maintenance BIGINT, depannage BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(DATE_TRUNC('month', scheduled_date), 'YYYY-MM'),
    COUNT(*),
    COUNT(*) FILTER (WHERE type = 'maintenance'),
    COUNT(*) FILTER (WHERE type = 'depannage')
  FROM interventions
  WHERE scheduled_date >= NOW() - (p_months || ' months')::INTERVAL
    AND status = 'termine'
  GROUP BY DATE_TRUNC('month', scheduled_date)
  ORDER BY DATE_TRUNC('month', scheduled_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
