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
  caught_at BIGINT NOT NULL
);

-- 3. Tabla de cooldown de tiradas ($p) por usuario y servidor
CREATE TABLE IF NOT EXISTS user_rolls (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_roll BIGINT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Permisos totales de lectura/escritura para la API del Bot
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

ALTER TABLE guild_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE captures DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_rolls DISABLE ROW LEVEL SECURITY;
