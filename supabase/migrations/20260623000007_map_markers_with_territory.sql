-- ============================================================
-- Migration 7 : get_map_markers — ajout territory_code + next_expiry
-- ============================================================

CREATE OR REPLACE FUNCTION get_map_markers(
  p_territory_code TEXT DEFAULT NULL,
  p_status         TEXT DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  latitude        DECIMAL,
  longitude       DECIMAL,
  status          TEXT,
  status_reason   TEXT,
  site_name       TEXT,
  client_name     TEXT,
  serial_number   TEXT,
  model           TEXT,
  territory_code  TEXT,
  next_expiry     DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    s.latitude,
    s.longitude,
    d.status,
    d.status_reason,
    s.name              AS site_name,
    c.name              AS client_name,
    d.serial_number,
    d.model,
    t.code              AS territory_code,
    LEAST(
      d.next_maintenance_date,
      d.battery_expiry,
      d.electrodes_adult_expiry,
      d.electrodes_pediatric_expiry
    )::DATE             AS next_expiry
  FROM defibrillators d
  JOIN sites       s ON s.id = d.site_id
  JOIN clients     c ON c.id = d.client_id
  JOIN territories t ON t.id = d.territory_id
  WHERE d.active = true
    AND s.latitude  IS NOT NULL
    AND s.longitude IS NOT NULL
    AND (p_territory_code IS NULL OR t.code = p_territory_code)
    AND (p_status         IS NULL OR d.status = p_status)
  ORDER BY d.status DESC, s.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
