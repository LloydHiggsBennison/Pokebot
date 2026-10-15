BEGIN;
CREATE TABLE IF NOT EXISTS public.commerce_config (id TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS public.commerce_accounts (
 guild_id TEXT NOT NULL,user_id TEXT NOT NULL,credits BIGINT NOT NULL DEFAULT 0 CHECK(credits>=0),
 special INTEGER NOT NULL DEFAULT 0 CHECK(special>=0),legendary INTEGER NOT NULL DEFAULT 0 CHECK(legendary>=0),
 mythical INTEGER NOT NULL DEFAULT 0 CHECK(mythical>=0),candy INTEGER NOT NULL DEFAULT 0 CHECK(candy>=0),
 hold BOOLEAN NOT NULL DEFAULT false,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS public.commerce_entitlements (
 source TEXT PRIMARY KEY,scope TEXT NOT NULL CHECK(scope IN ('user','guild')),target TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,payer TEXT NOT NULL,revoked BOOLEAN NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS commerce_entitlements_target_idx ON public.commerce_entitlements(scope,target,expires_at);
CREATE TABLE IF NOT EXISTS public.commerce_receipts (request_id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.commerce_daily (guild_id TEXT NOT NULL,user_id TEXT NOT NULL,day DATE NOT NULL,purchases INTEGER NOT NULL DEFAULT 0,gifts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id,day));
CREATE TABLE IF NOT EXISTS public.commerce_rolls (guild_id TEXT NOT NULL,user_id TEXT NOT NULL,window_id BIGINT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id,window_id));
CREATE TABLE IF NOT EXISTS public.commerce_checkouts (
 id UUID PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,sku TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
 provider_id TEXT UNIQUE,approval_url TEXT,paid BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.commerce_keys (hash TEXT PRIMARY KEY,sku TEXT NOT NULL,days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 366),expires_at TIMESTAMPTZ NOT NULL,used_by TEXT,used_guild TEXT);
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['commerce_config','commerce_accounts','commerce_entitlements','commerce_receipts','commerce_daily','commerce_rolls','commerce_checkouts','commerce_keys'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.commerce_premium(p_scope TEXT,p_target TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.commerce_entitlements WHERE scope=p_scope AND target=p_target AND NOT revoked AND expires_at>now()); $$;
CREATE OR REPLACE FUNCTION public.commerce_state(p_guild TEXT,p_user TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('coins',coalesce((SELECT balance FROM public.pokecoin_wallets WHERE guild_id=p_guild AND user_id=p_user),0),
 'account',coalesce((SELECT to_jsonb(a) FROM public.commerce_accounts a WHERE guild_id=p_guild AND user_id=p_user),'{}'::JSONB),
 'personal',public.commerce_premium('user',p_user),'server',public.commerce_premium('guild',p_guild),
 'day',(now() AT TIME ZONE 'America/Santiago')::DATE::TEXT,
 'purchases',coalesce((SELECT purchases FROM public.commerce_daily WHERE guild_id=p_guild AND user_id=p_user AND day=(now() AT TIME ZONE 'America/Santiago')::DATE),0)); $$;

CREATE OR REPLACE FUNCTION public.commerce_grant(p_checkout UUID,p_payment TEXT,p_until TIMESTAMPTZ DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.commerce_checkouts%ROWTYPE; prior public.commerce_receipts%ROWTYPE; amount BIGINT; result JSONB;
BEGIN
 SELECT * INTO c FROM public.commerce_checkouts WHERE id=p_checkout FOR UPDATE;
 IF NOT FOUND OR c.provider_id IS NULL THEN RAISE EXCEPTION 'Unknown checkout'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payment:'||p_payment,0));
 SELECT * INTO prior FROM public.commerce_receipts WHERE request_id='payment:'||p_payment;
 IF FOUND THEN
  IF prior.guild_id<>c.guild_id OR prior.user_id<>c.user_id OR prior.result->>'checkout'<>p_checkout::TEXT THEN RAISE EXCEPTION 'Payment mismatch';END IF;
  RETURN prior.result;
 END IF;
 INSERT INTO public.commerce_accounts(guild_id,user_id) VALUES(c.guild_id,c.user_id) ON CONFLICT DO NOTHING;
 IF c.sku IN ('personal','server') THEN
  IF p_until IS NULL OR p_until<=now() OR p_until>now()+interval '40 days' THEN RAISE EXCEPTION 'Invalid paid period'; END IF;
  INSERT INTO public.commerce_entitlements(source,scope,target,expires_at,payer) VALUES(c.provider_id,CASE WHEN c.sku='personal' THEN 'user' ELSE 'guild' END,CASE WHEN c.sku='personal' THEN c.user_id ELSE c.guild_id END,p_until,c.user_id)
  ON CONFLICT(source) DO UPDATE SET expires_at=greatest(commerce_entitlements.expires_at,excluded.expires_at);
 ELSE
  amount=CASE c.sku WHEN 'credits1' THEN 300 WHEN 'credits5' THEN 700 WHEN 'credits10' THEN 1300 WHEN 'credits20' THEN 2100 WHEN 'credits50' THEN 10000 ELSE NULL END;
  IF amount IS NULL THEN RAISE EXCEPTION 'Invalid product'; END IF;
  IF NOT c.paid THEN UPDATE public.commerce_accounts SET credits=credits+amount,legendary=legendary+CASE WHEN c.sku='credits50' THEN 5 ELSE 0 END,mythical=mythical+CASE WHEN c.sku='credits50' THEN 1 ELSE 0 END WHERE guild_id=c.guild_id AND user_id=c.user_id; END IF;
 END IF;
 UPDATE public.commerce_checkouts SET paid=true WHERE id=c.id;
 result=jsonb_build_object('checkout',c.id,'sku',c.sku,'paid',true);
 INSERT INTO public.commerce_receipts VALUES('payment:'||p_payment,c.guild_id,c.user_id,'payment',result,now());
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.commerce_action(p_guild TEXT,p_user TEXT,p_request TEXT,p_kind TEXT,p_data JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.commerce_accounts%ROWTYPE; prior public.commerce_receipts%ROWTYPE; result JSONB;
 premium BOOLEAN; today DATE=(now() AT TIME ZONE 'America/Santiago')::DATE; n INTEGER; price INTEGER; coins BIGINT; reward JSONB;
 c public.captures%ROWTYPE; win BIGINT=floor(extract(epoch FROM now())/600); qty INTEGER; cap INTEGER; k public.commerce_keys%ROWTYPE;
BEGIN
 IF coalesce(p_guild,'')='' OR coalesce(p_user,'')='' OR coalesce(p_request,'')='' THEN RAISE EXCEPTION 'Invalid identity';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commerce:'||p_guild||':'||p_user,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt:'||p_request,0));
 SELECT * INTO prior FROM public.commerce_receipts WHERE request_id=p_request;
 IF FOUND THEN IF prior.guild_id<>p_guild OR prior.user_id<>p_user OR prior.kind<>p_kind THEN RAISE EXCEPTION 'Receipt mismatch';END IF;RETURN prior.result;END IF;
 INSERT INTO public.commerce_accounts(guild_id,user_id) VALUES(p_guild,p_user) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM public.commerce_accounts WHERE guild_id=p_guild AND user_id=p_user FOR UPDATE;
 IF a.hold THEN RAISE EXCEPTION 'Account requires payment review';END IF;
 premium=public.commerce_premium('user',p_user);
 INSERT INTO public.commerce_daily(guild_id,user_id,day) VALUES(p_guild,p_user,today) ON CONFLICT DO NOTHING;
 IF p_kind='buy' THEN
  SELECT purchases INTO n FROM public.commerce_daily WHERE guild_id=p_guild AND user_id=p_user AND day=today;
  IF n>=7 THEN RETURN jsonb_build_object('status','daily_limit');END IF;
  IF a.special>=(CASE WHEN premium THEN 50 ELSE 10 END) THEN RETURN jsonb_build_object('status','capacity');END IF;
  price=(ARRAY[100,200,400,600,800,1000,2000])[n+1];
  IF (p_data->>'price')::INTEGER IS DISTINCT FROM price OR p_data->>'day' IS DISTINCT FROM today::TEXT THEN RETURN jsonb_build_object('status','changed');END IF;
  IF p_data->>'currency'='credits' THEN
   IF a.credits<price THEN RETURN jsonb_build_object('status','insufficient');END IF;
   UPDATE public.commerce_accounts SET credits=credits-price WHERE guild_id=p_guild AND user_id=p_user;
  ELSIF p_data->>'currency'='coins' THEN
   SELECT balance INTO coins FROM public.pokecoin_wallets WHERE guild_id=p_guild AND user_id=p_user FOR UPDATE;
   IF coalesce(coins,0)<price THEN RETURN jsonb_build_object('status','insufficient');END IF;
   UPDATE public.pokecoin_wallets SET balance=balance-price WHERE guild_id=p_guild AND user_id=p_user;
  ELSE RAISE EXCEPTION 'Invalid currency';END IF;
  UPDATE public.commerce_accounts SET special=special+1 WHERE guild_id=p_guild AND user_id=p_user;
  UPDATE public.commerce_daily SET purchases=purchases+1 WHERE guild_id=p_guild AND user_id=p_user AND day=today;
  result=jsonb_build_object('status','purchased','price',price);
 ELSIF p_kind='item' THEN
  IF a.credits<100 THEN RETURN jsonb_build_object('status','insufficient');END IF;
  UPDATE public.commerce_accounts SET credits=credits-100,candy=candy+1 WHERE guild_id=p_guild AND user_id=p_user;
  result=jsonb_build_object('status','item_purchased','price',100);
 ELSIF p_kind='redeem' THEN
  IF p_data->>'ticket'='special' AND a.special>0 THEN UPDATE public.commerce_accounts SET special=special-1 WHERE guild_id=p_guild AND user_id=p_user;
  ELSIF p_data->>'ticket'='legendary' AND a.legendary>0 THEN UPDATE public.commerce_accounts SET legendary=legendary-1 WHERE guild_id=p_guild AND user_id=p_user;
  ELSIF p_data->>'ticket'='mythical' AND a.mythical>0 THEN UPDATE public.commerce_accounts SET mythical=mythical-1 WHERE guild_id=p_guild AND user_id=p_user;
  ELSE RETURN jsonb_build_object('status','no_tickets');END IF;
  reward=p_data->'reward';
  IF (reward->>'id')::INTEGER NOT BETWEEN 1 AND 1025 OR coalesce(reward->>'rarity','') NOT IN ('rare','legendary','mythical') OR (p_data->>'ticket'='legendary' AND (reward->>'rarity'<>'legendary' OR NOT (reward->>'isShiny')::BOOLEAN)) OR (p_data->>'ticket'='mythical' AND (reward->>'rarity'<>'mythical' OR (reward->>'isShiny')::BOOLEAN)) THEN RAISE EXCEPTION 'Invalid reward';END IF;
  INSERT INTO public.captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level,experience,rarity) VALUES(p_guild,p_user,(reward->>'id')::INTEGER,reward->>'name',CASE WHEN (reward->>'isShiny')::BOOLEAN THEN 1 ELSE 0 END,(extract(epoch FROM now())*1000)::BIGINT,5,125,reward->>'rarity');
  result=jsonb_build_object('status','redeemed','reward',reward);
 ELSIF p_kind='level' THEN
  qty=(p_data->>'quantity')::INTEGER;
  IF qty IS NULL OR qty<1 OR qty>1000 THEN RAISE EXCEPTION 'Invalid quantity';END IF;
  SELECT * INTO c FROM public.captures WHERE id=(p_data->>'copy')::BIGINT AND guild_id=p_guild AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR c.battle_until>(extract(epoch FROM now())*1000)::BIGINT THEN RETURN jsonb_build_object('status','unavailable');END IF;
  IF coalesce(c.level,5)>=100 THEN RETURN jsonb_build_object('status','max_level');END IF;
  qty=least(qty,ceil((1000000-greatest(c.experience,power(coalesce(c.level,5),3)))/1000)::INTEGER);
  IF a.candy<qty THEN RETURN jsonb_build_object('status','no_items');END IF;
  UPDATE public.commerce_accounts SET candy=candy-qty WHERE guild_id=p_guild AND user_id=p_user;
  UPDATE public.captures SET experience=least(1000000,greatest(experience,power(coalesce(level,5),3))+qty*1000),level=least(100,floor(power(least(1000000,greatest(experience,power(coalesce(level,5),3))+qty*1000),1.0/3)+0.000001)::INTEGER) WHERE id=c.id RETURNING * INTO c;
  result=jsonb_build_object('status','levelled','level',c.level,'used',qty,'name',c.pokemon_name);
 ELSIF p_kind='roll' THEN
  qty=(p_data->>'quantity')::INTEGER;cap=1+CASE WHEN premium THEN 2 ELSE 0 END+CASE WHEN public.commerce_premium('guild',p_guild) THEN 2 ELSE 0 END;
  IF qty IS NULL OR qty<1 OR qty>20 THEN RAISE EXCEPTION 'Invalid roll count';END IF;
  INSERT INTO public.commerce_rolls VALUES(p_guild,p_user,win,0) ON CONFLICT DO NOTHING;
  SELECT used INTO n FROM public.commerce_rolls WHERE guild_id=p_guild AND user_id=p_user AND window_id=win;
  IF n+qty>cap THEN RETURN jsonb_build_object('status','roll_limit','remaining',greatest(0,cap-n),'reset',(win+1)*600);END IF;
  UPDATE public.commerce_rolls SET used=used+qty WHERE guild_id=p_guild AND user_id=p_user AND window_id=win;
  FOR reward IN SELECT value FROM jsonb_array_elements(p_data->'winners') LOOP
   INSERT INTO public.captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at) VALUES(p_guild,p_user,(reward->>'id')::INTEGER,reward->>'name',CASE WHEN (reward->>'isShiny')::BOOLEAN THEN 1 ELSE 0 END,(extract(epoch FROM now())*1000)::BIGINT);
  END LOOP;
  result=jsonb_build_object('status','rolled');
 ELSIF p_kind='key' THEN
  SELECT * INTO k FROM public.commerce_keys WHERE hash=p_data->>'hash' FOR UPDATE;
  IF NOT FOUND OR k.expires_at<=now() OR k.used_by IS NOT NULL THEN RETURN jsonb_build_object('status','invalid_key');END IF;
  UPDATE public.commerce_keys SET used_by=p_user,used_guild=p_guild WHERE hash=k.hash;
  IF k.sku IN ('personal','server') THEN
  INSERT INTO public.commerce_entitlements VALUES('key:'||k.hash,CASE WHEN k.sku='personal' THEN 'user' ELSE 'guild' END,CASE WHEN k.sku='personal' THEN p_user ELSE p_guild END,now()+make_interval(days=>k.days),p_user,false);
  result=jsonb_build_object('status','activated','days',k.days);
  ELSE
   n=CASE k.sku WHEN 'credits1' THEN 300 WHEN 'credits5' THEN 700 WHEN 'credits10' THEN 1300 WHEN 'credits20' THEN 2100 WHEN 'credits50' THEN 10000 ELSE NULL END;
   IF n IS NULL THEN RAISE EXCEPTION 'Invalid key product';END IF;
   UPDATE public.commerce_accounts SET credits=credits+n,legendary=legendary+CASE WHEN k.sku='credits50' THEN 5 ELSE 0 END,mythical=mythical+CASE WHEN k.sku='credits50' THEN 1 ELSE 0 END WHERE guild_id=p_guild AND user_id=p_user;
   result=jsonb_build_object('status','credited','credits',n);
  END IF;
 ELSE RAISE EXCEPTION 'Unknown operation';END IF;
 INSERT INTO public.commerce_receipts VALUES(p_request,p_guild,p_user,p_kind,result,now());
 RETURN result;
END $$;
DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('commerce_premium','commerce_state','commerce_grant','commerce_action') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
ALTER TABLE public.captures ALTER COLUMN experience TYPE NUMERIC(16,1);
CREATE OR REPLACE FUNCTION public.commerce_save_battle(p_id UUID,p_expected INTEGER,p_actor TEXT,p_state JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old public.pokemon_battles%ROWTYPE; s JSONB=p_state; g TEXT=p_state->>'guildId';
 users JSONB=p_state->'users'; f JSONB; u TEXT; cid BIGINT; c public.captures%ROWTYPE;
 now_ms BIGINT=(extract(epoch FROM clock_timestamp())*1000)::BIGINT; winner TEXT; xp NUMERIC; prior INTEGER; total NUMERIC; lvl INTEGER;
BEGIN
 IF g IS NULL OR jsonb_array_length(users)<>2 OR users->>0=users->>1 OR NOT users ? p_actor
   OR coalesce(s->>'status','') NOT IN ('invited','selecting','active','finished','cancelled') THEN RAISE EXCEPTION 'Invalid battle'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('battle:'||g,0));
 SELECT * INTO old FROM public.pokemon_battles WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF old.guild_id<>g OR old.state->'users'<>users THEN RAISE EXCEPTION 'Battle mismatch'; END IF;
  IF old.revision<>p_expected OR old.status IN ('finished','cancelled') THEN RETURN jsonb_build_object('conflict',true,'state',old.state,'revision',old.revision); END IF;
  IF old.status='active' AND old.state->'fighters'->((old.state->>'turn')::INTEGER)->>'user'<>p_actor AND coalesce(s->>'reason','')<>'surrender' THEN RAISE EXCEPTION 'Not your turn'; END IF;
 ELSE
  IF p_expected<>-1 OR s->>'status'<>'invited' OR users->>0<>p_actor THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  DELETE FROM public.pokemon_battle_players WHERE until_ms<=now_ms;
  FOR u IN SELECT jsonb_array_elements_text(users) LOOP
   INSERT INTO public.pokemon_battle_players VALUES(g,u,p_id,now_ms+360000);
  END LOOP;
 END IF;
 -- Lock and verify selected copies before storing any state.
 UPDATE public.captures SET battle_id=NULL,battle_until=NULL WHERE battle_id=p_id
  AND id NOT IN(SELECT (value->>'copyId')::BIGINT FROM jsonb_array_elements(coalesce(s->'fighters','[]'::JSONB)) WHERE value<>'null'::JSONB);
 PERFORM id FROM public.captures WHERE id IN(SELECT (value->>'copyId')::BIGINT FROM jsonb_array_elements(coalesce(s->'fighters','[]'::JSONB)) WHERE value<>'null'::JSONB) ORDER BY id FOR UPDATE;
 FOR f IN SELECT value FROM jsonb_array_elements(coalesce(s->'fighters','[]'::JSONB)) WHERE value<>'null'::JSONB LOOP
  cid=(f->>'copyId')::BIGINT;
  SELECT * INTO c FROM public.captures WHERE id=cid AND guild_id=g AND user_id=f->>'user';
  IF NOT FOUND OR NOT users ? (f->>'user') OR (c.battle_id IS NOT NULL AND c.battle_id<>p_id AND c.battle_until>now_ms) THEN
   IF s->>'status' IN ('finished','cancelled') THEN s=s||jsonb_build_object('status','cancelled','winner',NULL); CONTINUE;
   ELSE RAISE EXCEPTION 'Copy unavailable'; END IF;
  END IF;
  UPDATE public.captures SET battle_id=p_id,battle_until=now_ms+360000 WHERE id=cid;
 END LOOP;
 IF s->>'status' IN ('finished','cancelled') THEN
  UPDATE public.captures SET battle_id=NULL,battle_until=NULL WHERE battle_id=p_id;
  DELETE FROM public.pokemon_battle_players WHERE battle_id=p_id;
  winner=s->>'winner';
  IF s->>'status'='finished' AND winner IS NOT NULL AND coalesce((s->>'turns')::INTEGER,0)>=4 THEN
   SELECT count(*) INTO prior FROM public.pokemon_battles WHERE guild_id=g AND status='finished' AND updated_at>now()-interval '24 hours'
    AND state->'users' @> users AND state->'users' <@ users;
   xp=CASE WHEN prior<3 THEN 100 WHEN prior<10 THEN 25 ELSE 0 END; IF NOT public.commerce_premium('user',winner) THEN xp=xp/2; END IF;
   SELECT (value->>'copyId')::BIGINT INTO cid FROM jsonb_array_elements(s->'fighters') WHERE value->>'user'=winner;
   SELECT greatest(experience,power(coalesce(level,5),3)::BIGINT)+xp INTO total FROM public.captures WHERE id=cid AND user_id=winner;
   lvl=least(100,floor(power(total::NUMERIC,1.0/3.0)+0.000001)::INTEGER);
   UPDATE public.captures SET experience=total,level=greatest(coalesce(level,5),lvl) WHERE id=cid AND user_id=winner;
   s=s||jsonb_build_object('xp',xp,'winnerLevel',lvl);
  ELSE s=s||jsonb_build_object('xp',0); END IF;
 ELSE
  UPDATE public.pokemon_battle_players SET until_ms=now_ms+360000 WHERE battle_id=p_id;
 END IF;
 INSERT INTO public.pokemon_battles(id,guild_id,state,revision,status,deadline) VALUES(p_id,g,s,p_expected+1,s->>'status',(s->>'deadline')::BIGINT)
 ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,status=excluded.status,deadline=excluded.deadline,updated_at=now();
 RETURN jsonb_build_object('state',s,'revision',p_expected+1,'conflict',false);
END; $$;
REVOKE ALL ON FUNCTION public.commerce_save_battle(UUID,INTEGER,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_save_battle(UUID,INTEGER,TEXT,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_fuse(p_request UUID,p_guild TEXT,p_user TEXT,p_capture BIGINT) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT public.commerce_premium('user',p_user) AND NOT EXISTS(SELECT 1 FROM public.pokemon_fusion_receipts WHERE request_id=p_request AND guild_id=p_guild AND user_id=p_user AND capture_id=p_capture) THEN RAISE EXCEPTION 'Personal premium required';END IF;
 RETURN public.fuse_selected_pokemon(p_request,p_guild,p_user,p_capture);
END $$;
CREATE OR REPLACE FUNCTION public.commerce_transfer(p_request_id UUID,p_guild_id TEXT,p_sender_id TEXT,p_receiver_id TEXT,p_give_id BIGINT,p_take_id BIGINT DEFAULT NULL) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n INTEGER; lim INTEGER; ok BOOLEAN; today DATE=(now() AT TIME ZONE 'America/Santiago')::DATE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('gifts:'||p_sender_id,0));
 IF EXISTS(SELECT 1 FROM public.pokemon_transfers WHERE request_id=p_request_id) THEN RETURN public.transfer_pokemon(p_request_id,p_guild_id,p_sender_id,p_receiver_id,p_give_id,p_take_id);END IF;
 IF p_take_id IS NOT NULL THEN
  IF NOT public.commerce_premium('user',p_sender_id) OR NOT public.commerce_premium('user',p_receiver_id) THEN RAISE EXCEPTION 'Both traders need personal premium';END IF;
 ELSE
  lim=CASE WHEN public.commerce_premium('user',p_sender_id) THEN 5 ELSE 1 END;
  INSERT INTO public.commerce_daily(guild_id,user_id,day) VALUES('*',p_sender_id,today) ON CONFLICT DO NOTHING;
  SELECT gifts INTO n FROM public.commerce_daily WHERE guild_id='*' AND user_id=p_sender_id AND day=today;
  IF n>=lim THEN RAISE EXCEPTION 'Daily gift limit reached';END IF;
 END IF;
 ok=public.transfer_pokemon(p_request_id,p_guild_id,p_sender_id,p_receiver_id,p_give_id,p_take_id);
 IF ok AND p_take_id IS NULL THEN UPDATE public.commerce_daily SET gifts=gifts+1 WHERE guild_id='*' AND user_id=p_sender_id AND day=today;END IF;
 RETURN ok;
END $$;
CREATE OR REPLACE FUNCTION public.commerce_wild(p_encounter_id UUID,p_guild_id TEXT,p_user_id TEXT,p_pokemon_id INTEGER,p_pokemon_name TEXT,p_level INTEGER,p_iv_total INTEGER,p_rarity TEXT,p_coins INTEGER) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result JSONB; BEGIN
 result=public.record_wild_capture(p_encounter_id,p_guild_id,p_user_id,p_pokemon_id,p_pokemon_name,p_level,p_iv_total,p_rarity,p_coins);
 IF (result->>'new_claim')::BOOLEAN THEN
  INSERT INTO public.commerce_accounts(guild_id,user_id,candy) VALUES(p_guild_id,p_user_id,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET candy=commerce_accounts.candy+1;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.commerce_fuse(UUID,TEXT,TEXT,BIGINT),public.commerce_transfer(UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT),public.commerce_wild(UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER,INTEGER,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_fuse(UUID,TEXT,TEXT,BIGINT),public.commerce_transfer(UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT),public.commerce_wild(UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER,INTEGER,TEXT,INTEGER) TO service_role;
COMMIT;
