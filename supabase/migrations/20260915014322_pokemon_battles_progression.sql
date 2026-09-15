BEGIN;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS level INTEGER;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS iv_total INTEGER;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS experience BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS battle_id UUID;
ALTER TABLE public.captures ADD COLUMN IF NOT EXISTS battle_until BIGINT;
CREATE TABLE IF NOT EXISTS public.pokemon_battles(
  id UUID PRIMARY KEY,guild_id TEXT NOT NULL,state JSONB NOT NULL,revision INTEGER NOT NULL,
  status TEXT NOT NULL,deadline BIGINT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pokemon_battles_deadline ON public.pokemon_battles(deadline) WHERE status IN ('invited','selecting','active');
CREATE TABLE IF NOT EXISTS public.pokemon_battle_players(
  guild_id TEXT NOT NULL,user_id TEXT NOT NULL,battle_id UUID NOT NULL,until_ms BIGINT NOT NULL,PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.pokemon_fusion_receipts(
  request_id UUID PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,capture_id BIGINT NOT NULL,result JSONB NOT NULL
);
ALTER TABLE public.pokemon_battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pokemon_battle_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pokemon_fusion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pokemon_battles,public.pokemon_battle_players,public.pokemon_fusion_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.pokemon_battles,public.pokemon_battle_players,public.pokemon_fusion_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.guard_battle_capture() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.battle_id IS NOT NULL AND OLD.battle_until>(extract(epoch FROM clock_timestamp())*1000)::BIGINT THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Pokemon is battling'; END IF;
  IF NEW.user_id<>OLD.user_id OR NEW.guild_id<>OLD.guild_id OR NEW.is_shiny<>OLD.is_shiny OR NEW.pokemon_id<>OLD.pokemon_id THEN
   RAISE EXCEPTION 'Pokemon is battling';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_battle_capture ON public.captures;
CREATE TRIGGER guard_battle_capture BEFORE DELETE OR UPDATE ON public.captures FOR EACH ROW EXECUTE FUNCTION public.guard_battle_capture();

CREATE OR REPLACE FUNCTION public.fuse_selected_pokemon(p_request UUID,p_guild TEXT,p_user TEXT,p_capture BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt public.pokemon_fusion_receipts%ROWTYPE; chosen public.captures%ROWTYPE; ids BIGINT[]; result JSONB; now_ms BIGINT=(extract(epoch FROM clock_timestamp())*1000)::BIGINT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::TEXT,0));
 SELECT * INTO receipt FROM public.pokemon_fusion_receipts WHERE request_id=p_request;
 IF FOUND THEN
  IF receipt.guild_id<>p_guild OR receipt.user_id<>p_user OR receipt.capture_id<>p_capture THEN RAISE EXCEPTION 'Fusion mismatch'; END IF;
  RETURN receipt.result;
 END IF;
 -- Match the battle/transfer lock ordering: all involved captures by ID.
 SELECT * INTO chosen FROM public.captures WHERE id=p_capture AND guild_id=p_guild AND user_id=p_user AND is_shiny=0;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM id FROM public.captures WHERE guild_id=p_guild AND user_id=p_user AND pokemon_id=chosen.pokemon_id AND is_shiny=0 ORDER BY id FOR UPDATE;
 SELECT * INTO chosen FROM public.captures WHERE id=p_capture AND guild_id=p_guild AND user_id=p_user AND is_shiny=0;
 IF NOT FOUND OR (chosen.battle_id IS NOT NULL AND chosen.battle_until>now_ms) THEN RETURN NULL; END IF;
 SELECT array_agg(id) INTO ids FROM (
  SELECT id FROM public.captures WHERE guild_id=p_guild AND user_id=p_user AND pokemon_id=chosen.pokemon_id AND is_shiny=0 AND id<>p_capture
   AND (battle_id IS NULL OR battle_until<=now_ms) ORDER BY coalesce(level,5),experience,id LIMIT 4
 ) AS donors;
 IF coalesce(array_length(ids,1),0)<4 THEN RETURN NULL; END IF;
 DELETE FROM public.captures WHERE id=ANY(ids[1:3]);
 UPDATE public.captures SET is_shiny=1 WHERE id=p_capture RETURNING to_jsonb(captures.*) INTO result;
 INSERT INTO public.pokemon_fusion_receipts VALUES(p_request,p_guild,p_user,p_capture,result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.fuse_selected_pokemon(UUID,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fuse_selected_pokemon(UUID,TEXT,TEXT,BIGINT) TO service_role;
REVOKE ALL ON FUNCTION public.fuse_pokemon(TEXT,TEXT,INTEGER,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.save_pokemon_battle(p_id UUID,p_expected INTEGER,p_actor TEXT,p_state JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old public.pokemon_battles%ROWTYPE; s JSONB=p_state; g TEXT=p_state->>'guildId';
 users JSONB=p_state->'users'; f JSONB; u TEXT; cid BIGINT; c public.captures%ROWTYPE;
 now_ms BIGINT=(extract(epoch FROM clock_timestamp())*1000)::BIGINT; winner TEXT; xp INTEGER; prior INTEGER; total BIGINT; lvl INTEGER;
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
   xp=CASE WHEN prior<3 THEN 100 WHEN prior<10 THEN 25 ELSE 0 END;
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
REVOKE ALL ON FUNCTION public.save_pokemon_battle(UUID,INTEGER,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_pokemon_battle(UUID,INTEGER,TEXT,JSONB) TO service_role;
COMMIT;
