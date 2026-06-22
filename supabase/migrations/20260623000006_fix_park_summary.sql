-- ============================================================
-- Migration 6 : Correction get_park_summary + get_interventions_monthly
-- ============================================================

-- ── get_park_summary : agrégats séparés pour éviter le nesting ────────────
CREATE OR REPLACE FUNCTION get_park_summary()
RETURNS JSON AS $$
DECLARE
  v_total       BIGINT;
  v_conforme    BIGINT;
  v_vigilance   BIGINT;
  v_critique    BIGINT;
  v_inconnu     BIGINT;
  v_by_territory JSON;
  v_next_exp    JSON;
  v_last_sync   TEXT;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'conforme'),
    COUNT(*) FILTER (WHERE status = 'vigilance'),
    COUNT(*) FILTER (WHERE status = 'critique'),
    COUNT(*) FILTER (WHERE status = 'inconnu')
  INTO v_total, v_conforme, v_vigilance, v_critique, v_inconnu
  FROM defibrillators
  WHERE active = true;

  SELECT json_object_agg(code, stats)
  INTO v_by_territory
  FROM (
    SELECT
      t.code,
      json_build_object(
        'total',     COUNT(d.id),
        'conforme',  COUNT(d.id) FILTER (WHERE d.status = 'conforme'),
        'vigilance', COUNT(d.id) FILTER (WHERE d.status = 'vigilance'),
        'critique',  COUNT(d.id) FILTER (WHERE d.status = 'critique'),
        'inconnu',   COUNT(d.id) FILTER (WHERE d.status = 'inconnu')
      ) AS stats
    FROM territories t
    LEFT JOIN defibrillators d ON d.territory_id = t.id AND d.active = true
    GROUP BY t.code
  ) territory_counts;

  SELECT json_agg(sub ORDER BY sub.next_date)
  INTO v_next_exp
  FROM (
    SELECT
      d.id, d.serial_number, d.model,
      c.name AS client_name,
      t.code AS territory_code,
      LEAST(
        d.next_maintenance_date,
        d.battery_expiry,
        d.electrodes_adult_expiry,
        d.electrodes_pediatric_expiry
      )::TEXT AS next_date,
      d.status_reason AS reason
    FROM defibrillators d
    LEFT JOIN clients     c ON c.id = d.client_id
    LEFT JOIN territories t ON t.id = d.territory_id
    WHERE d.active = true
      AND d.status IN ('critique', 'vigilance')
      AND LEAST(
        d.next_maintenance_date,
        d.battery_expiry,
        d.electrodes_adult_expiry,
        d.electrodes_pediatric_expiry
      ) IS NOT NULL
    ORDER BY next_date
    LIMIT 10
  ) sub;

  SELECT finished_at::TEXT
  INTO v_last_sync
  FROM sync_logs
  WHERE source = 'synchroteam' AND status = 'success'
  ORDER BY finished_at DESC
  LIMIT 1;

  RETURN json_build_object(
    'total',            v_total,
    'conforme',         v_conforme,
    'vigilance',        v_vigilance,
    'critique',         v_critique,
    'inconnu',          v_inconnu,
    'by_territory',     v_by_territory,
    'next_expirations', v_next_exp,
    'last_sync',        v_last_sync
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── get_interventions_monthly : tous statuts, groupés par scheduled_date ──
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
    AND scheduled_date IS NOT NULL
  GROUP BY DATE_TRUNC('month', scheduled_date)
  ORDER BY DATE_TRUNC('month', scheduled_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
