BEGIN;
CREATE TABLE IF NOT EXISTS public.pokemon_market_purchases(
  guild_id TEXT NOT NULL,user_id TEXT NOT NULL,rotation BIGINT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 6),
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL,rarity TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,user_id,rotation,slot)
);
ALTER TABLE public.pokemon_market_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pokemon_market_purchases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.pokemon_market_purchases TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.pokecoin_wallets TO service_role;
GRANT INSERT ON public.captures TO service_role;
CREATE OR REPLACE FUNCTION public.buy_market_pokemon(
  p_guild_id TEXT,p_user_id TEXT,p_rotation BIGINT,p_slot INTEGER,
  p_pokemon_id INTEGER,p_pokemon_name TEXT,p_rarity TEXT,p_price INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous public.pokemon_market_purchases%ROWTYPE; wallet BIGINT; expected_price INTEGER;
BEGIN
  expected_price := CASE p_rarity WHEN 'common' THEN 100 WHEN 'uncommon' THEN 250 WHEN 'rare' THEN 1000 WHEN 'legendary' THEN 5000 WHEN 'mythical' THEN 10000 ELSE NULL END;
  IF p_guild_id IS NULL OR p_user_id IS NULL OR p_guild_id='' OR p_user_id='' OR p_rotation IS NULL
    OR p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 6 OR p_pokemon_id IS NULL OR p_pokemon_id NOT BETWEEN 1 AND 1025
    OR p_pokemon_name IS NULL OR p_pokemon_name='' OR expected_price IS NULL OR p_price IS DISTINCT FROM expected_price THEN
    RAISE EXCEPTION 'Invalid market offer';
  END IF;
  -- Serialize all purchases against the same wallet, including different slots.
  INSERT INTO public.pokecoin_wallets(guild_id,user_id,balance) VALUES(p_guild_id,p_user_id,0) ON CONFLICT DO NOTHING;
  SELECT balance INTO wallet FROM public.pokecoin_wallets WHERE guild_id=p_guild_id AND user_id=p_user_id FOR UPDATE;
  SELECT * INTO previous FROM public.pokemon_market_purchases
    WHERE guild_id=p_guild_id AND user_id=p_user_id AND rotation=p_rotation AND slot=p_slot;
  IF FOUND THEN
    IF previous.pokemon_id<>p_pokemon_id OR previous.price<>p_price OR previous.pokemon_name<>p_pokemon_name OR previous.rarity<>p_rarity THEN RAISE EXCEPTION 'Offer mismatch'; END IF;
    RETURN jsonb_build_object('status','purchased','balance',wallet,'new_purchase',false,'pokemon_name',previous.pokemon_name);
  END IF;
  IF p_rotation <> floor(extract(epoch FROM clock_timestamp())/3600)::BIGINT THEN
    RETURN jsonb_build_object('status','expired','balance',wallet);
  END IF;
  IF wallet<p_price THEN RETURN jsonb_build_object('status','insufficient','balance',wallet); END IF;
  UPDATE public.pokecoin_wallets SET balance=balance-p_price WHERE guild_id=p_guild_id AND user_id=p_user_id;
  INSERT INTO public.captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,rarity)
    VALUES(p_guild_id,p_user_id,p_pokemon_id,p_pokemon_name,0,(extract(epoch FROM clock_timestamp())*1000)::BIGINT,p_rarity);
  INSERT INTO public.pokemon_market_purchases(guild_id,user_id,rotation,slot,pokemon_id,pokemon_name,rarity,price)
    VALUES(p_guild_id,p_user_id,p_rotation,p_slot,p_pokemon_id,p_pokemon_name,p_rarity,p_price);
  RETURN jsonb_build_object('status','purchased','balance',wallet-p_price,'new_purchase',true,'pokemon_name',p_pokemon_name);
END; $$;
REVOKE ALL ON FUNCTION public.buy_market_pokemon(TEXT,TEXT,BIGINT,INTEGER,INTEGER,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.buy_market_pokemon(TEXT,TEXT,BIGINT,INTEGER,INTEGER,TEXT,TEXT,INTEGER) TO service_role;
COMMIT;
