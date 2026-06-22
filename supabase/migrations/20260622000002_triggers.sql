-- ============================================================
-- Migration 2 : Triggers
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Mise à jour automatique de updated_at sur defibrillators
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
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER set_custom_field_mapping_updated_at
  BEFORE UPDATE ON custom_field_mapping
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Création automatique du profil lors de l'inscription
-- ────────────────────────────────────────────────────────────
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
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
