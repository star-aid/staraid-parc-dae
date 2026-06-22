-- ============================================================
-- Migration 1 : Schéma complet parc DAE STAR aid
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Territoires
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS territories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  code       TEXT        UNIQUE NOT NULL,     -- 'REU', 'MYT', 'GLP'
  timezone   TEXT        NOT NULL,            -- 'Indian/Reunion', ...
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO territories (name, code, timezone) VALUES
  ('La Réunion', 'REU', 'Indian/Reunion'),
  ('Mayotte',    'MYT', 'Indian/Mayotte'),
  ('Guadeloupe', 'GLP', 'America/Guadeloupe')
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Mapping custom fields Synchroteam (configurable sans redéploiement)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_field_mapping (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_field_id  INTEGER UNIQUE NOT NULL,
  synchroteam_label     TEXT    NOT NULL,
  internal_field        TEXT    NOT NULL,  -- 'battery_expiry', 'electrodes_expiry', etc.
  field_type            TEXT    NOT NULL   CHECK (field_type IN ('date', 'text', 'number')),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- Profils utilisateurs (lié à auth.users Supabase)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT  NOT NULL DEFAULT 'technicien'
                     CHECK (role IN ('dt', 'technicien', 'direction')),
  territory_id UUID  REFERENCES territories(id),
  full_name    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- Clients
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- Sites
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- Défibrillateurs (DAE)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defibrillators (
  id                    UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id        TEXT  UNIQUE NOT NULL,
  serial_number         TEXT,
  model                 TEXT,
  brand                 TEXT,
  client_id             UUID  REFERENCES clients(id),
  site_id               UUID  REFERENCES sites(id),
  territory_id          UUID  REFERENCES territories(id),

  -- Statut calculé
  status                TEXT  NOT NULL DEFAULT 'inconnu'
                              CHECK (status IN ('conforme', 'vigilance', 'critique', 'inconnu')),
  status_reason         TEXT,

  -- Dates clés (extraites custom fields Synchroteam)
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  battery_expiry        DATE,
  electrodes_expiry     DATE,

  -- Statuts consommables calculés
  battery_status        TEXT  DEFAULT 'inconnu'
                              CHECK (battery_status IN ('ok', 'a_remplacer', 'expire', 'inconnu')),
  electrodes_status     TEXT  DEFAULT 'inconnu'
                              CHECK (electrodes_status IN ('ok', 'a_remplacer', 'expire', 'inconnu')),

  -- Données brutes custom fields (flexible)
  custom_fields         JSONB,

  -- Contrat
  contract_type         TEXT,
  contract_start        DATE,
  contract_end          DATE,

  notes                 TEXT,
  active                BOOLEAN   DEFAULT TRUE,
  synced_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- Techniciens
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS technicians (
  id                   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id       TEXT  UNIQUE NOT NULL,
  first_name           TEXT,
  last_name            TEXT,
  login                TEXT,
  email                TEXT,
  territory_id         UUID  REFERENCES territories(id),
  active               BOOLEAN DEFAULT TRUE,
  synced_at            TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- Interventions
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interventions (
  id                          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  synchroteam_id              TEXT  UNIQUE NOT NULL,
  defibrillator_id            UUID  REFERENCES defibrillators(id),
  site_id                     UUID  REFERENCES sites(id),
  client_id                   UUID  REFERENCES clients(id),
  type                        TEXT  CHECK (type IN ('maintenance', 'depannage', 'installation', 'autre')),
  status                      TEXT  CHECK (status IN ('planifie', 'en_cours', 'termine', 'annule')),
  scheduled_date              TIMESTAMPTZ,
  completed_date              TIMESTAMPTZ,
  technician_name             TEXT,
  technician_synchroteam_id   TEXT,
  duration_minutes            INTEGER,
  report                      TEXT,
  custom_fields               JSONB,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- Logs de synchronisation
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_logs (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT  NOT NULL,  -- 'synchroteam', 'axonaut'
  status          TEXT  NOT NULL   CHECK (status IN ('running', 'success', 'error')),
  records_synced  INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- Index
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
