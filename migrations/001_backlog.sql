CREATE TABLE IF NOT EXISTS public.backlog_state (
  owner_id text PRIMARY KEY,
  document jsonb NOT NULL DEFAULT '{"buckets":[]}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlog_document_shape CHECK (jsonb_typeof(document) = 'object')
);

ALTER TABLE public.backlog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backlog_state FROM PUBLIC, anonymous, authenticated;
GRANT SELECT ON public.backlog_state TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'backlog_state' AND policyname = 'backlog_owner_read') THEN
    CREATE POLICY backlog_owner_read ON public.backlog_state FOR SELECT TO authenticated
      USING (owner_id = (SELECT auth.user_id()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_backlog(expected_revision bigint, next_document jsonb)
RETURNS public.backlog_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner text := auth.user_id();
  current_row public.backlog_state%ROWTYPE;
  bucket jsonb;
  item jsonb;
  bucket_ids text[] := ARRAY[]::text[];
  item_ids text[] := ARRAY[]::text[];
  identifier text;
BEGIN
  IF owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_snapshot WHERE id = 1 AND owner_id = owner
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF next_document IS NULL OR jsonb_typeof(next_document) <> 'object'
      OR jsonb_typeof(next_document->'buckets') IS DISTINCT FROM 'array'
      OR pg_column_size(next_document) > 200000
      OR jsonb_array_length(next_document->'buckets') > 100 THEN
    RAISE EXCEPTION 'Invalid backlog' USING ERRCODE = '22023';
  END IF;
  FOR bucket IN SELECT value FROM jsonb_array_elements(next_document->'buckets') LOOP
    identifier := bucket->>'id';
    IF jsonb_typeof(bucket) <> 'object' OR identifier IS NULL
        OR length(identifier) > 100 OR identifier = ANY(bucket_ids)
        OR jsonb_typeof(bucket->'title') IS DISTINCT FROM 'string'
        OR length(trim(bucket->>'title')) NOT BETWEEN 1 AND 200
        OR bucket->>'stage' NOT IN ('collecting','pending','in_progress','done')
        OR jsonb_typeof(bucket->'version') IS DISTINCT FROM 'string'
        OR length(bucket->>'version') > 60
        OR jsonb_typeof(bucket->'items') IS DISTINCT FROM 'array'
        OR jsonb_array_length(bucket->'items') > 500 THEN
      RAISE EXCEPTION 'Invalid backlog bucket' USING ERRCODE = '22023';
    END IF;
    bucket_ids := array_append(bucket_ids, identifier);
    FOR item IN SELECT value FROM jsonb_array_elements(bucket->'items') LOOP
      identifier := item->>'id';
      IF jsonb_typeof(item) <> 'object' OR identifier IS NULL
          OR length(identifier) > 100 OR identifier = ANY(item_ids)
          OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string'
          OR length(trim(item->>'text')) NOT BETWEEN 1 AND 1000
          OR jsonb_typeof(item->'done') IS DISTINCT FROM 'boolean'
          OR jsonb_typeof(item->'note') IS DISTINCT FROM 'boolean'
          OR jsonb_typeof(item->'depth') IS DISTINCT FROM 'number'
          OR (item->>'depth') !~ '^[0-8]$' THEN
        RAISE EXCEPTION 'Invalid backlog item' USING ERRCODE = '22023';
      END IF;
      item_ids := array_append(item_ids, identifier);
    END LOOP;
  END LOOP;
  SELECT * INTO current_row FROM public.backlog_state
    WHERE owner_id = owner FOR UPDATE;
  IF NOT FOUND OR current_row.revision <> expected_revision THEN
    RAISE EXCEPTION 'Backlog changed on another device' USING ERRCODE = '40001';
  END IF;
  UPDATE public.backlog_state SET document = next_document,
      revision = revision + 1, updated_at = now()
    WHERE owner_id = owner RETURNING * INTO current_row;
  RETURN current_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_backlog(bigint,jsonb) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.save_backlog(bigint,jsonb) TO authenticated;
