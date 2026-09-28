-- ============================================================
-- Migration 13 : agrégats SQL pour le tableau de bord et la barre latérale
--
-- Remplace une vingtaine de requêtes de comptage par affichage du tableau
-- de bord par trois appels RPC. Additive : ne modifie ni ne supprime aucune
-- table ni fonction existante.
--
-- À appliquer avant de déployer le code qui les utilise : npm run db:push
-- (écrite le 22/09/2026 comme migration 8, renumérotée pour suivre l'ordre appliqué).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Comptage des DAE par territoire et statut, avec les filtres du tableau
--    de bord. Une seule requête remplace les 5 comptages globaux + 15 par
--    territoire faits auparavant depuis l'application.
--
--    p_active          : true / false ; NULL = tous
--    p_client_id       : DAE rattachés au client, directement ou via un de ses sites
--    p_contract_in     : types de contrat à inclure (groupes Location / Maintenance,
--                        ou sélection explicite dans « Autres »)
--    p_contract_not_in : types à exclure (« Autres » sans sélection = tout sauf
--                        Location et Maintenance)
--    p_contract_null   : inclure les DAE sans type de contrat
--    Sans filtre contrat : les trois derniers paramètres à NULL / false.
--    La combinaison des parties contrat est un OU, comme dans l'application
--    (cf. lib/contract-groups.ts, buildContratSqlParams).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_dashboard_status_counts(
  p_active          BOOLEAN DEFAULT NULL,
  p_client_id       UUID    DEFAULT NULL,
  p_contract_in     TEXT[]  DEFAULT NULL,
  p_contract_not_in TEXT[]  DEFAULT NULL,
  p_contract_null   BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  territory_code TEXT,
  dae_status     TEXT,
  dae_count      BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.code,
    d.status,
    COUNT(*)
  FROM defibrillators d
  LEFT JOIN territories t ON t.id = d.territory_id
  WHERE (p_active IS NULL OR d.active = p_active)
    AND (
      p_client_id IS NULL
      OR d.client_id = p_client_id
      OR d.site_id IN (SELECT s.id FROM sites s WHERE s.client_id = p_client_id)
    )
    AND (
      -- aucun filtre contrat
      (p_contract_in IS NULL AND p_contract_not_in IS NULL AND NOT COALESCE(p_contract_null, FALSE))
      -- types inclus
      OR (p_contract_in IS NOT NULL AND d.contract_type = ANY (p_contract_in))
      -- « Autres » sans sélection : tout sauf les types exclus (les NULL sont gérés ci-dessous)
      OR (p_contract_not_in IS NOT NULL AND d.contract_type IS NOT NULL
          AND NOT (d.contract_type = ANY (p_contract_not_in)))
      -- DAE sans type de contrat
      OR (COALESCE(p_contract_null, FALSE) AND d.contract_type IS NULL)
    )
  GROUP BY t.code, d.status;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 2. Interventions réalisées par mois (12 derniers mois par défaut), sur la
--    date de réalisation (completed_date), avec filtre client optionnel.
--    Même découpage que la page tableau de bord, qui regroupait jusqu'ici
--    plusieurs milliers de lignes côté application.
--    Distinct de get_interventions_monthly (migration 6), qui travaille sur
--    scheduled_date et ne filtre pas par client.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_dashboard_interventions_monthly(
  p_months    INTEGER DEFAULT 12,
  p_client_id UUID    DEFAULT NULL
)
RETURNS TABLE (
  month       TEXT,
  total       BIGINT,
  maintenance BIGINT,
  depannage   BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(DATE_TRUNC('month', i.completed_date), 'YYYY-MM') AS month,
    COUNT(*)                                                  AS total,
    COUNT(*) FILTER (WHERE i.type = 'maintenance')            AS maintenance,
    COUNT(*) FILTER (WHERE i.type = 'depannage')              AS depannage
  FROM interventions i
  WHERE i.completed_date IS NOT NULL
    AND i.completed_date >= (CURRENT_DATE - (p_months || ' months')::INTERVAL)
    AND (
      p_client_id IS NULL
      OR i.client_id = p_client_id
      OR i.site_id IN (SELECT s.id FROM sites s WHERE s.client_id = p_client_id)
    )
  GROUP BY DATE_TRUNC('month', i.completed_date)
  ORDER BY DATE_TRUNC('month', i.completed_date);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 3. Répartition de tous les DAE par type de contrat (NULL inclus), pour le
--    filtre « Autres » de la barre latérale. Agrégé en SQL : la requête
--    précédente lisait la colonne de chaque DAE et était plafonnée à
--    1 000 lignes par Supabase, ce qui faussait les compteurs au-delà.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_contract_type_counts()
RETURNS TABLE (
  contract_type TEXT,
  dae_count     BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.contract_type, COUNT(*)
  FROM defibrillators d
  GROUP BY d.contract_type
  ORDER BY d.contract_type;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 4. Droits d'exécution : sur ce projet, une fonction créée par migration
--    n'est exécutable que par son propriétaire (privilèges par défaut
--    restreints, cf. migration 10). L'application appelle ces fonctions avec
--    le rôle service ; les utilisateurs connectés y ont aussi accès.
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION get_dashboard_status_counts(BOOLEAN, UUID, TEXT[], TEXT[], BOOLEAN) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_interventions_monthly(INTEGER, UUID)                 TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION get_contract_type_counts()                                          TO service_role, authenticated;
