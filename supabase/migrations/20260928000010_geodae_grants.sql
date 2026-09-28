-- ============================================================
-- Migration 10 : droits d'accès sur les tables du journal Géo'DAE
--
-- Sur ce projet Supabase, les privilèges par défaut du schéma public ont été
-- restreints : une table créée par une migration ne donne au rôle service_role
-- que REFERENCES / TRIGGER / TRUNCATE (pas de SELECT ni d'écriture). Les tables
-- historiques ont, elles, tous les droits pour service_role. On aligne les deux
-- tables de la migration 9 sur cette convention : l'application lit et écrit le
-- journal uniquement via le rôle service (cf. lib/geodae/journal.ts).
--
-- Les rôles anon et authenticated restent sans accès direct, comme sur les
-- autres tables ; les politiques RLS de la migration 9 sont conservées.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE geodae_reconciliation_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE geodae_anomalies           TO service_role;
