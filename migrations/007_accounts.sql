-- Shared catalog, personal coffee state, and member feature requests.
-- Apply after 001–006. The existing snapshot owner becomes the admin.
BEGIN;

CREATE TABLE public.app_users (
  user_id text PRIMARY KEY,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  roasters text[] NOT NULL DEFAULT '{}',
  setup_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_users(user_id, role, roasters, setup_complete)
SELECT owner_id, 'admin', ARRAY(
  SELECT DISTINCT bean->>'roaster' FROM jsonb_array_elements(payload->'beans') bean
  WHERE bean->>'roaster' IS NOT NULL ORDER BY 1
), true FROM public.app_snapshot WHERE id = 1;

CREATE TABLE public.personal_archives (
  user_id text NOT NULL REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  bean_id text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bean_id)
);
INSERT INTO public.personal_archives(user_id, bean_id)
SELECT s.owner_id, bean->>'id' FROM public.app_snapshot s,
  LATERAL jsonb_array_elements(s.payload->'beans') bean
WHERE s.id = 1 AND bean->>'archived' = 'true'
ON CONFLICT DO NOTHING;

CREATE TABLE public.feature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id text NOT NULL REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT completed_matches_status CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX feature_requests_newest ON public.feature_requests(created_at DESC);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_users, public.personal_archives, public.feature_requests FROM PUBLIC, anonymous, authenticated;
GRANT SELECT ON public.app_users, public.personal_archives TO authenticated;
GRANT SELECT (id,text,status,created_at,completed_at) ON public.feature_requests TO authenticated;
CREATE POLICY own_profile ON public.app_users FOR SELECT TO authenticated
  USING (user_id = (select auth.user_id()));
CREATE POLICY own_archives ON public.personal_archives FOR SELECT TO authenticated
  USING (user_id = (select auth.user_id()));
CREATE POLICY member_requests ON public.feature_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE user_id = (select auth.user_id())));

DROP POLICY owner_snapshot_read ON public.app_snapshot;
REVOKE SELECT ON public.app_snapshot FROM authenticated;
GRANT SELECT (id,payload,published_at) ON public.app_snapshot TO authenticated;
CREATE POLICY member_snapshot_read ON public.app_snapshot FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE user_id = (select auth.user_id())));

CREATE FUNCTION public.bootstrap_account() RETURNS public.app_users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); profile public.app_users%ROWTYPE;
BEGIN
  IF person IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.app_users(user_id) VALUES (person) ON CONFLICT DO NOTHING;
  INSERT INTO public.wishlist_state(owner_id) VALUES (person) ON CONFLICT DO NOTHING;
  SELECT * INTO profile FROM public.app_users WHERE user_id = person;
  RETURN profile;
END;
$$;

CREATE FUNCTION public.save_roaster_subscriptions(next_roasters text[]) RETURNS public.app_users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); profile public.app_users%ROWTYPE;
BEGIN
  IF person IS NULL OR next_roasters IS NULL OR cardinality(next_roasters) < 1
      OR cardinality(next_roasters) > 100 OR EXISTS (
        SELECT 1 FROM unnest(next_roasters) r WHERE r IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements((SELECT payload->'beans' FROM public.app_snapshot WHERE id=1)) bean
          WHERE bean->>'roaster' = r
        )
      ) OR (SELECT count(DISTINCT r) FROM unnest(next_roasters) r) <> cardinality(next_roasters) THEN
    RAISE EXCEPTION 'Choose one or more available roasters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.app_users SET roasters = next_roasters, setup_complete = true
    WHERE user_id = person RETURNING * INTO profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is not ready' USING ERRCODE = '42501'; END IF;
  RETURN profile;
END;
$$;

CREATE FUNCTION public.set_personal_archive(listing text, do_archive boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id();
BEGIN
  IF person IS NULL OR do_archive IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE user_id = person
  ) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT payload->'beans' FROM public.app_snapshot WHERE id=1)) bean
      WHERE bean->>'id' = listing) THEN
    RAISE EXCEPTION 'Unknown bean' USING ERRCODE = '22023';
  END IF;
  IF do_archive THEN
    INSERT INTO public.personal_archives(user_id, bean_id) VALUES (person, listing) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.personal_archives WHERE user_id = person AND bean_id = listing;
  END IF;
END;
$$;

CREATE FUNCTION public.submit_feature_request(request_text text) RETURNS public.feature_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); item public.feature_requests%ROWTYPE;
BEGIN
  IF person IS NULL OR NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = person) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF request_text IS NULL OR length(btrim(request_text)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Write a request of up to 2000 characters' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.feature_requests(author_id, text) VALUES (person, btrim(request_text))
    RETURNING * INTO item;
  RETURN item;
END;
$$;

CREATE FUNCTION public.set_feature_request_completed(request_id uuid, is_complete boolean)
RETURNS public.feature_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); item public.feature_requests%ROWTYPE;
BEGIN
  IF person IS NULL OR NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = person AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  IF is_complete IS NULL THEN RAISE EXCEPTION 'Completion choice required' USING ERRCODE = '22023'; END IF;
  UPDATE public.feature_requests SET status = CASE WHEN is_complete THEN 'completed' ELSE 'requested' END,
    completed_at = CASE WHEN is_complete THEN now() ELSE NULL END
    WHERE id = request_id RETURNING * INTO item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown request' USING ERRCODE = '22023'; END IF;
  RETURN item;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_wishlist(expected_revision bigint, next_ids jsonb)
RETURNS public.wishlist_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); current_row public.wishlist_state%ROWTYPE; item jsonb;
BEGIN
  IF person IS NULL OR NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = person)
    THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF next_ids IS NULL OR jsonb_typeof(next_ids) <> 'array' OR jsonb_array_length(next_ids) > 1000
    THEN RAISE EXCEPTION 'Invalid Wish list' USING ERRCODE = '22023'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(next_ids) LOOP
    IF jsonb_typeof(item) <> 'string' OR length(item #>> '{}') > 500 OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements((SELECT payload->'beans' FROM public.app_snapshot WHERE id=1)) bean
      WHERE bean->>'id' = item #>> '{}'
    ) THEN RAISE EXCEPTION 'Unknown bean ID' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(next_ids)) <> jsonb_array_length(next_ids)
    THEN RAISE EXCEPTION 'Duplicate bean ID' USING ERRCODE = '22023'; END IF;
  SELECT * INTO current_row FROM public.wishlist_state WHERE owner_id = person FOR UPDATE;
  IF NOT FOUND OR current_row.revision <> expected_revision
    THEN RAISE EXCEPTION 'Wish list changed on another device' USING ERRCODE = '40001'; END IF;
  UPDATE public.wishlist_state SET ids = next_ids, revision = revision + 1, updated_at = now()
    WHERE owner_id = person RETURNING * INTO current_row;
  RETURN current_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id();
BEGIN
  IF person IS NULL OR NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id=person)
    THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF sub_endpoint IS NULL OR length(sub_endpoint) > 2000 OR sub_p256dh IS NULL OR sub_auth IS NULL
    THEN RAISE EXCEPTION 'Invalid subscription' USING ERRCODE='22023'; END IF;
  INSERT INTO public.push_subscriptions(owner_id, endpoint, p256dh, auth_key)
    VALUES (person, sub_endpoint, sub_p256dh, sub_auth)
    ON CONFLICT (owner_id, endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh, auth_key=EXCLUDED.auth_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_replacement(old_listing text, new_listing text, do_accept boolean)
RETURNS public.wishlist_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); target public.wishlist_state%ROWTYPE; own_row public.wishlist_state%ROWTYPE;
BEGIN
  IF person IS NULL OR do_accept IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE user_id=person AND role='admin'
  ) THEN RAISE EXCEPTION 'Admin only' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
      (SELECT payload->'suggestions' FROM public.app_snapshot WHERE id=1)
    ) s WHERE s->>'old_id'=old_listing AND s->>'new_id'=new_listing) THEN
    RAISE EXCEPTION 'Unknown replacement' USING ERRCODE='22023'; END IF;
  INSERT INTO public.replacement_decisions(owner_id,old_id,new_id,accepted)
    VALUES (person,old_listing,new_listing,do_accept) ON CONFLICT DO NOTHING;
  IF do_accept THEN
    FOR target IN SELECT * FROM public.wishlist_state WHERE ids ? old_listing FOR UPDATE LOOP
      UPDATE public.wishlist_state SET ids = (
        SELECT COALESCE(jsonb_agg(d.v ORDER BY d.ord),'[]'::jsonb) FROM (
          SELECT DISTINCT ON (m.v) m.v,m.ord FROM (
            SELECT CASE WHEN e.value=to_jsonb(old_listing) THEN to_jsonb(new_listing) ELSE e.value END v,e.ord
            FROM jsonb_array_elements(target.ids) WITH ORDINALITY e(value,ord)
          ) m ORDER BY m.v,m.ord
        ) d), revision=revision+1,updated_at=now() WHERE owner_id=target.owner_id;
    END LOOP;
    INSERT INTO public.personal_archives(user_id,bean_id,archived_at)
      SELECT user_id,new_listing,archived_at FROM public.personal_archives WHERE bean_id=old_listing
      ON CONFLICT DO NOTHING;
    DELETE FROM public.personal_archives WHERE bean_id=old_listing;
  END IF;
  SELECT * INTO own_row FROM public.wishlist_state WHERE owner_id=person;
  RETURN own_row;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_account() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.save_roaster_subscriptions(text[]) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.set_personal_archive(text, boolean) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.submit_feature_request(text) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.set_feature_request_completed(uuid, boolean) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.bootstrap_account(), public.save_roaster_subscriptions(text[]),
  public.set_personal_archive(text, boolean), public.submit_feature_request(text),
  public.set_feature_request_completed(uuid, boolean) TO authenticated;

COMMIT;
