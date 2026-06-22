-- ============================================================
-- Migration 4 : Fonctions utilitaires
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Résumé parc pour le contexte agent IA
-- Utilisé par /api/ai/analyse pour construire le prompt système
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_park_summary()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total',       COUNT(*),
    'conforme',    COUNT(*) FILTER (WHERE status = 'conforme'),
    'vigilance',   COUNT(*) FILTER (WHERE status = 'vigilance'),
    'critique',    COUNT(*) FILTER (WHERE status = 'critique'),
    'inconnu',     COUNT(*) FILTER (WHERE status = 'inconnu'),
    'by_territory', (
      SELECT json_object_agg(
        t.code,
        json_build_object(
          'total',     COUNT(d.id),
          'conforme',  COUNT(d.id) FILTER (WHERE d.status = 'conforme'),
          'vigilance', COUNT(d.id) FILTER (WHERE d.status = 'vigilance'),
          'critique',  COUNT(d.id) FILTER (WHERE d.status = 'critique'),
          'inconnu',   COUNT(d.id) FILTER (WHERE d.status = 'inconnu')
        )
      )
      FROM territories t
      LEFT JOIN defibrillators d ON d.territory_id = t.id AND d.active = true
      GROUP BY t.code
    ),
    'next_expirations', (
      SELECT json_agg(sub ORDER BY sub.next_date)
      FROM (
        SELECT
          d.id,
          d.serial_number,
          d.model,
          c.name  AS client_name,
          t.code  AS territory_code,
          LEAST(
            d.next_maintenance_date,
            d.battery_expiry,
            d.electrodes_expiry
          )::TEXT AS next_date,
          d.status_reason AS reason
        FROM defibrillators d
        LEFT JOIN clients    c ON c.id = d.client_id
        LEFT JOIN territories t ON t.id = d.territory_id
        WHERE d.active = true
          AND d.status IN ('critique', 'vigilance')
          AND LEAST(d.next_maintenance_date, d.battery_expiry, d.electrodes_expiry) IS NOT NULL
        ORDER BY next_date
        LIMIT 10
      ) sub
    ),
    'last_sync', (
      SELECT finished_at::TEXT
      FROM sync_logs
      WHERE source = 'synchroteam' AND status = 'success'
      ORDER BY finished_at DESC
      LIMIT 1
    )
  )
  INTO result
  FROM defibrillators
  WHERE active = true;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────────────────────
-- Données carte : marqueurs DAE (champs minimaux pour performance)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_map_markers(
  p_territory_code TEXT DEFAULT NULL,
  p_status         TEXT DEFAULT NULL
)
RETURNS TABLE (
  id           UUID,
  latitude     DECIMAL,
  longitude    DECIMAL,
  status       TEXT,
  status_reason TEXT,
  site_name    TEXT,
  client_name  TEXT,
  serial_number TEXT,
  model        TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    s.latitude,
    s.longitude,
    d.status,
    d.status_reason,
    s.name       AS site_name,
    c.name       AS client_name,
    d.serial_number,
    d.model
  FROM defibrillators d
  JOIN sites       s ON s.id = d.site_id
  JOIN clients     c ON c.id = d.client_id
  JOIN territories t ON t.id = d.territory_id
  WHERE d.active = true
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
    AND (p_territory_code IS NULL OR t.code = p_territory_code)
    AND (p_status IS NULL OR d.status = p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────────────────────
-- KPIs mensuels interventions (graphique 12 mois glissants)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_interventions_monthly(p_months INTEGER DEFAULT 12)
RETURNS TABLE (
  month        TEXT,
  total        BIGINT,
  maintenance  BIGINT,
  depannage    BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(DATE_TRUNC('month', scheduled_date), 'YYYY-MM') AS month,
    COUNT(*)                                                  AS total,
    COUNT(*) FILTER (WHERE type = 'maintenance')              AS maintenance,
    COUNT(*) FILTER (WHERE type = 'depannage')                AS depannage
  FROM interventions
  WHERE scheduled_date >= NOW() - (p_months || ' months')::INTERVAL
    AND status = 'termine'
  GROUP BY DATE_TRUNC('month', scheduled_date)
  ORDER BY DATE_TRUNC('month', scheduled_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
