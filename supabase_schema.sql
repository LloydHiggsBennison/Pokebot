-- ==========================================
-- Esquema de Supabase (PostgreSQL) para Pokebot
-- ==========================================

-- 1. Tabla de configuración por servidor (Discord Guild)
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  spawn_channel_id TEXT,
  mode TEXT DEFAULT 'messages',
  msg_min INT DEFAULT 15,
  msg_max INT DEFAULT 40,
  time_interval_seconds INT DEFAULT 1800,
  catch_command TEXT DEFAULT '$p',
  enabled INT DEFAULT 1,
  puzzle_cooldown_seconds INT DEFAULT 0
);

-- 2. Tabla de capturas de usuarios por servidor
CREATE TABLE IF NOT EXISTS captures (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pokemon_name TEXT NOT NULL,
  pokemon_id INT NOT NULL,
  is_shiny INT NOT NULL DEFAULT 0,
  caught_at BIGINT NOT NULL
);

-- 3. Tabla de cooldown de tiradas ($p) por usuario y servidor
CREATE TABLE IF NOT EXISTS user_rolls (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_roll BIGINT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Evita recorrer todo el historial para cada badge NEW.
CREATE INDEX IF NOT EXISTS captures_owner_pokemon_idx
  ON captures (guild_id, user_id, pokemon_name);

CREATE INDEX IF NOT EXISTS captures_fusion_idx
  ON captures (guild_id, user_id, pokemon_id, is_shiny, id);

-- Atomic fusion procedure for $pokefuse; see supabase_migration_pokefuse.sql.
CREATE OR REPLACE FUNCTION public.fuse_pokemon(
  p_guild_id TEXT, p_user_id TEXT, p_pokemon_id INTEGER, p_pokemon_name TEXT
)
RETURNS TABLE (pokemon_id INTEGER, pokemon_name TEXT, consumed INTEGER)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE normal_ids BIGINT[];
BEGIN
  SELECT ARRAY_AGG(id ORDER BY id) INTO normal_ids FROM (
    SELECT c.id FROM public.captures AS c
    WHERE c.guild_id = p_guild_id AND c.user_id = p_user_id AND c.pokemon_id = p_pokemon_id
      AND COALESCE(c.is_shiny, 0) = 0 ORDER BY c.id LIMIT 5 FOR UPDATE
  ) locked;
  IF COALESCE(array_length(normal_ids, 1), 0) < 5 THEN RETURN; END IF;
  DELETE FROM public.captures WHERE id = ANY(normal_ids[2:5]);
  INSERT INTO public.captures (guild_id,user_id,pokemon_name,pokemon_id,is_shiny,caught_at)
  VALUES (p_guild_id,p_user_id,p_pokemon_name,p_pokemon_id,1,(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);
  RETURN QUERY SELECT p_pokemon_id, p_pokemon_name, 4;
END; $$;
REVOKE ALL ON FUNCTION public.fuse_pokemon(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fuse_pokemon(TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated, service_role;

-- Permisos totales de lectura/escritura para la API del Bot
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

ALTER TABLE guild_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE captures DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_rolls DISABLE ROW LEVEL SECURITY;
