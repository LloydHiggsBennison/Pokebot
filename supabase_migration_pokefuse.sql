-- Apply once to the existing Supabase project before deploying $pokefuse.
ALTER TABLE public.captures
  ADD COLUMN IF NOT EXISTS is_shiny INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS captures_fusion_idx
  ON public.captures (guild_id, user_id, pokemon_id, is_shiny, id);

CREATE OR REPLACE FUNCTION public.fuse_pokemon(
  p_guild_id TEXT,
  p_user_id TEXT,
  p_pokemon_id INTEGER,
  p_pokemon_name TEXT
)
RETURNS TABLE (pokemon_id INTEGER, pokemon_name TEXT, consumed INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normal_ids BIGINT[];
BEGIN
  SELECT ARRAY_AGG(id ORDER BY id)
    INTO normal_ids
    FROM (
      SELECT c.id FROM public.captures AS c
      WHERE c.guild_id = p_guild_id AND c.user_id = p_user_id
        AND c.pokemon_id = p_pokemon_id AND COALESCE(c.is_shiny, 0) = 0
      ORDER BY c.id
      LIMIT 5
      FOR UPDATE
    ) locked;

  IF COALESCE(array_length(normal_ids, 1), 0) < 5 THEN
    RETURN;
  END IF;

  DELETE FROM public.captures
    WHERE id = ANY(normal_ids[2:5]);

  INSERT INTO public.captures
    (guild_id, user_id, pokemon_name, pokemon_id, is_shiny, caught_at)
  VALUES
    (p_guild_id, p_user_id, p_pokemon_name, p_pokemon_id, 1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);

  RETURN QUERY SELECT p_pokemon_id, p_pokemon_name, 4;
END;
$$;

REVOKE ALL ON FUNCTION public.fuse_pokemon(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fuse_pokemon(TEXT, TEXT, INTEGER, TEXT)
  TO anon, authenticated, service_role;
