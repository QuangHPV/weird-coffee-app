-- Named posters, durable filters and onboarding, and member requests in admin TODOs.
-- Apply after 007_accounts.sql.
BEGIN;

ALTER TABLE public.app_users
  ADD COLUMN display_name text NOT NULL DEFAULT 'Member',
  ADD COLUMN filter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN filter_revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN tour_complete boolean NOT NULL DEFAULT false;
UPDATE public.app_users a SET display_name = COALESCE(NULLIF(btrim(u.name), ''), 'Member')
  FROM neon_auth."user" u WHERE u.id::text = a.user_id;

ALTER TABLE public.feature_requests ADD COLUMN author_name text NOT NULL DEFAULT 'Member';
UPDATE public.feature_requests f SET author_name = a.display_name
  FROM public.app_users a WHERE a.user_id = f.author_id;
GRANT SELECT (author_name) ON public.feature_requests TO authenticated;

UPDATE public.backlog_state b SET document = jsonb_set(document, '{tasks}',
  COALESCE((SELECT jsonb_agg(e.value || jsonb_build_object(
      'author_id', b.owner_id, 'author_name', a.display_name) ORDER BY e.ord)
    FROM jsonb_array_elements(b.document->'tasks') WITH ORDINALITY e(value,ord)), '[]'::jsonb)),
  revision = revision + 1, updated_at = now()
  FROM public.app_users a WHERE a.user_id = b.owner_id;

CREATE OR REPLACE FUNCTION public.bootstrap_account() RETURNS public.app_users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); profile public.app_users%ROWTYPE; poster text;
BEGIN
  IF person IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(NULLIF(btrim(name), ''), 'Member') INTO poster
    FROM neon_auth."user" WHERE id::text = person;
  INSERT INTO public.app_users(user_id, display_name) VALUES (person, COALESCE(poster, 'Member'))
    ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  INSERT INTO public.wishlist_state(owner_id) VALUES (person) ON CONFLICT DO NOTHING;
  SELECT * INTO profile FROM public.app_users WHERE user_id = person;
  RETURN profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_roaster_subscriptions(next_roasters text[]) RETURNS public.app_users
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
  UPDATE public.app_users SET roasters = next_roasters, setup_complete = true,
    filter_revision = filter_revision + 1
    WHERE user_id = person RETURNING * INTO profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is not ready' USING ERRCODE = '42501'; END IF;
  RETURN profile;
END;
$$;

CREATE FUNCTION public.save_filter_preferences(expected_revision bigint, next_roasters text[], next_filters jsonb)
RETURNS public.app_users LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); profile public.app_users%ROWTYPE;
BEGIN
  IF person IS NULL OR next_filters IS NULL OR jsonb_typeof(next_filters) <> 'object'
      OR pg_column_size(next_filters) > 10000 OR next_roasters IS NULL
      OR cardinality(next_roasters) NOT BETWEEN 1 AND 100
      OR EXISTS (SELECT 1 FROM unnest(next_roasters) r WHERE r IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements((SELECT payload->'beans' FROM public.app_snapshot WHERE id=1)) bean
          WHERE bean->>'roaster' = r))
      OR (SELECT count(DISTINCT r) FROM unnest(next_roasters) r) <> cardinality(next_roasters) THEN
    RAISE EXCEPTION 'Invalid filters or roasters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO profile FROM public.app_users WHERE user_id = person FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is not ready' USING ERRCODE = '42501'; END IF;
  IF profile.filter_revision <> expected_revision THEN
    RAISE EXCEPTION 'Filters changed on another device' USING ERRCODE = '40001';
  END IF;
  UPDATE public.app_users SET roasters = next_roasters, filter_state = next_filters,
      filter_revision = filter_revision + 1, setup_complete = true
    WHERE user_id = person RETURNING * INTO profile;
  RETURN profile;
END;
$$;

CREATE FUNCTION public.complete_account_guide() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id();
BEGIN
  IF person IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.app_users SET tour_complete = true WHERE user_id = person;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is not ready' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_feature_request(request_text text) RETURNS public.feature_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); poster text; item public.feature_requests%ROWTYPE;
  admin_id text;
BEGIN
  SELECT display_name INTO poster FROM public.app_users WHERE user_id = person AND role = 'member';
  IF person IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'Member account required' USING ERRCODE = '42501'; END IF;
  IF request_text IS NULL OR length(btrim(request_text)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Write a request of up to 2000 characters' USING ERRCODE = '22023'; END IF;
  SELECT b.owner_id INTO admin_id FROM public.backlog_state b
    JOIN public.app_users a ON a.user_id = b.owner_id AND a.role = 'admin'
    ORDER BY b.owner_id LIMIT 1 FOR UPDATE OF b;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'Admin backlog is not ready' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.feature_requests(author_id, author_name, text)
    VALUES (person, poster, btrim(request_text)) RETURNING * INTO item;
  UPDATE public.backlog_state SET document = jsonb_set(document, '{tasks}',
      COALESCE(document->'tasks', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', 'request:' || item.id::text, 'text', item.text, 'created', item.created_at,
        'done_at', NULL, 'request_id', item.id::text,
        'author_id', person, 'author_name', poster))),
      revision = revision + 1, updated_at = now() WHERE owner_id = admin_id;
  RETURN item;
END;
$$;

CREATE FUNCTION public.sync_request_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.feature_requests f SET
    status = CASE WHEN task.value->>'done_at' IS NULL THEN 'requested' ELSE 'completed' END,
    completed_at = (task.value->>'done_at')::timestamptz
    FROM jsonb_array_elements(NEW.document->'tasks') task(value)
    WHERE task.value ? 'request_id' AND f.id::text = task.value->>'request_id'
      AND (f.status IS DISTINCT FROM CASE WHEN task.value->>'done_at' IS NULL THEN 'requested' ELSE 'completed' END
        OR f.completed_at IS DISTINCT FROM (task.value->>'done_at')::timestamptz);
  RETURN NEW;
END;
$$;
CREATE TRIGGER backlog_request_completion AFTER UPDATE OF document ON public.backlog_state
  FOR EACH ROW EXECUTE FUNCTION public.sync_request_completion();

CREATE OR REPLACE FUNCTION public.save_backlog(expected_revision bigint, next_document jsonb)
RETURNS public.backlog_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id(); poster text; current_row public.backlog_state%ROWTYPE;
  task jsonb; prior jsonb; normalized jsonb := '[]'::jsonb;
  task_ids text[] := ARRAY[]::text[]; identifier text;
BEGIN
  SELECT display_name INTO poster FROM public.app_users WHERE user_id = person AND role = 'admin';
  IF person IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  IF next_document IS NULL OR jsonb_typeof(next_document) <> 'object'
      OR jsonb_typeof(next_document->'tasks') IS DISTINCT FROM 'array'
      OR pg_column_size(next_document) > 400000
      OR jsonb_array_length(next_document->'tasks') > 2000 THEN
    RAISE EXCEPTION 'Invalid backlog' USING ERRCODE = '22023'; END IF;
  SELECT * INTO current_row FROM public.backlog_state WHERE owner_id = person FOR UPDATE;
  IF NOT FOUND OR current_row.revision <> expected_revision THEN
    RAISE EXCEPTION 'Backlog changed on another device' USING ERRCODE = '40001'; END IF;
  FOR task IN SELECT value FROM jsonb_array_elements(next_document->'tasks') LOOP
    identifier := task->>'id';
    IF jsonb_typeof(task) <> 'object' OR identifier IS NULL
        OR length(identifier) > 100 OR identifier = ANY(task_ids)
        OR jsonb_typeof(task->'text') IS DISTINCT FROM 'string'
        OR length(trim(task->>'text')) NOT BETWEEN 1 AND 2000
        OR jsonb_typeof(task->'created') IS DISTINCT FROM 'string'
        OR length(task->>'created') > 40
        OR jsonb_typeof(task->'done_at') NOT IN ('null', 'string')
        OR length(COALESCE(task->>'done_at', '')) > 40 THEN
      RAISE EXCEPTION 'Invalid backlog task' USING ERRCODE = '22023'; END IF;
    task_ids := array_append(task_ids, identifier);
    SELECT value INTO prior FROM jsonb_array_elements(current_row.document->'tasks')
      WHERE value->>'id' = identifier;
    task := task - 'author_id' - 'author_name' - 'request_id';
    IF prior IS NULL THEN
      task := task || jsonb_build_object('author_id', person, 'author_name', poster);
    ELSE
      task := task || jsonb_build_object('author_id', COALESCE(prior->>'author_id', person),
        'author_name', COALESCE(prior->>'author_name', poster));
      IF prior ? 'request_id' THEN
        task := task || jsonb_build_object('request_id', prior->>'request_id', 'text', prior->>'text');
      END IF;
    END IF;
    normalized := normalized || jsonb_build_array(task);
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(current_row.document->'tasks') existing
      WHERE existing ? 'request_id' AND NOT (existing->>'id' = ANY(task_ids))) THEN
    RAISE EXCEPTION 'Feature request TODOs cannot be deleted' USING ERRCODE = '22023'; END IF;
  UPDATE public.backlog_state SET document = jsonb_build_object('tasks', normalized),
    revision = revision + 1, updated_at = now() WHERE owner_id = person RETURNING * INTO current_row;
  RETURN current_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_filter_preferences(bigint,text[],jsonb),
  public.complete_account_guide() FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.save_filter_preferences(bigint,text[],jsonb),
  public.complete_account_guide() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_feature_request_completed(uuid,boolean) FROM authenticated;

COMMIT;
