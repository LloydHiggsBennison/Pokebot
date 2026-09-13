-- Run before deploying wild rewards and language preferences. Safe to repeat.
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS level INTEGER;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS iv_total INTEGER;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS rarity TEXT;
CREATE TABLE IF NOT EXISTS public.bot_languages (
  scope_id TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('es', 'en'))
);
CREATE TABLE IF NOT EXISTS public.pokecoin_wallets (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.wild_claims (
  encounter_id UUID PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  pokemon_id INTEGER NOT NULL, pokemon_name TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 100),
  iv_total INTEGER NOT NULL CHECK (iv_total BETWEEN 0 AND 186),
  rarity TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','legendary','mythical')),
  coins INTEGER NOT NULL CHECK (coins IN (10,20,35,150,300)),
  caught_at BIGINT NOT NULL
);
ALTER TABLE public.bot_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pokecoin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wild_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_languages, public.pokecoin_wallets, public.wild_claims FROM anon, authenticated;
GRANT ALL ON public.bot_languages, public.pokecoin_wallets, public.wild_claims TO service_role;

CREATE OR REPLACE FUNCTION public.record_wild_capture(
 p_encounter_id UUID, p_guild_id TEXT, p_user_id TEXT,
 p_pokemon_id INTEGER, p_pokemon_name TEXT,
 p_level INTEGER, p_iv_total INTEGER, p_rarity TEXT, p_coins INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE claim public.wild_claims%ROWTYPE; inserted_count INTEGER; wallet_balance BIGINT;
BEGIN
 IF p_coins <> (CASE p_rarity WHEN 'common' THEN 10 WHEN 'uncommon' THEN 20
   WHEN 'rare' THEN 35 WHEN 'legendary' THEN 150 WHEN 'mythical' THEN 300 ELSE -1 END)
 THEN RAISE EXCEPTION 'Invalid rarity reward'; END IF;
 INSERT INTO public.wild_claims VALUES (p_encounter_id,p_guild_id,p_user_id,p_pokemon_id,
   p_pokemon_name,p_level,p_iv_total,p_rarity,p_coins,
   (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT)
 ON CONFLICT (encounter_id) DO NOTHING;
 GET DIAGNOSTICS inserted_count = ROW_COUNT;
 SELECT c.* INTO claim FROM public.wild_claims AS c WHERE c.encounter_id=p_encounter_id;
 IF claim.guild_id <> p_guild_id OR claim.user_id <> p_user_id THEN RETURN NULL; END IF;
 IF inserted_count = 1 THEN
   INSERT INTO public.captures (guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level,iv_total,rarity)
   VALUES (claim.guild_id,claim.user_id,claim.pokemon_id,claim.pokemon_name,0,claim.caught_at,claim.level,claim.iv_total,claim.rarity);
   INSERT INTO public.pokecoin_wallets AS w (guild_id,user_id,balance)
   VALUES (claim.guild_id,claim.user_id,claim.coins)
   ON CONFLICT (guild_id,user_id) DO UPDATE SET balance=w.balance+EXCLUDED.balance;
 END IF;
 SELECT w.balance INTO wallet_balance FROM public.pokecoin_wallets AS w WHERE w.guild_id=p_guild_id AND w.user_id=p_user_id;
 RETURN to_jsonb(claim) || jsonb_build_object('balance',wallet_balance,'new_claim',inserted_count=1);
END; $$;
REVOKE ALL ON FUNCTION public.record_wild_capture(UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER,INTEGER,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_wild_capture(UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER,INTEGER,TEXT,INTEGER) TO service_role;

