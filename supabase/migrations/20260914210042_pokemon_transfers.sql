BEGIN;
CREATE TABLE IF NOT EXISTS public.pokemon_transfers (
  request_id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pokemon_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pokemon_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.pokemon_transfers TO service_role;
GRANT SELECT, UPDATE ON public.captures TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_pokemon(
  p_request_id UUID, p_guild_id TEXT, p_sender_id TEXT, p_receiver_id TEXT,
  p_give_id BIGINT, p_take_id BIGINT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  expected JSONB;
  previous JSONB;
  give_owner TEXT;
  take_owner TEXT;
BEGIN
  IF p_request_id IS NULL OR p_guild_id IS NULL OR p_sender_id IS NULL OR p_receiver_id IS NULL
    OR p_guild_id = '' OR p_sender_id = '' OR p_receiver_id = ''
    OR p_sender_id = p_receiver_id OR p_give_id IS NULL OR p_give_id = p_take_id THEN
    RAISE EXCEPTION 'Invalid transfer';
  END IF;
  expected := jsonb_build_object('guild',p_guild_id,'sender',p_sender_id,'receiver',p_receiver_id,'give',p_give_id,'take',p_take_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT payload INTO previous FROM public.pokemon_transfers WHERE request_id = p_request_id;
  IF FOUND THEN
    IF previous <> expected THEN RAISE EXCEPTION 'Transfer mismatch'; END IF;
    RETURN true;
  END IF;
  -- Lock both copies in a stable order, including when offers overlap.
  PERFORM id FROM public.captures WHERE id IN (p_give_id,p_take_id) ORDER BY id FOR UPDATE;
  SELECT user_id INTO give_owner FROM public.captures WHERE id = p_give_id AND guild_id = p_guild_id;
  IF give_owner IS DISTINCT FROM p_sender_id THEN RETURN false; END IF;
  IF p_take_id IS NOT NULL THEN
    SELECT user_id INTO take_owner FROM public.captures WHERE id = p_take_id AND guild_id = p_guild_id;
    IF take_owner IS DISTINCT FROM p_receiver_id THEN RETURN false; END IF;
  END IF;
  UPDATE public.captures SET user_id = p_receiver_id WHERE id = p_give_id;
  IF p_take_id IS NOT NULL THEN UPDATE public.captures SET user_id = p_sender_id WHERE id = p_take_id; END IF;
  INSERT INTO public.pokemon_transfers(request_id,payload) VALUES(p_request_id,expected);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_pokemon(UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_pokemon(UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT) TO service_role;
COMMIT;
