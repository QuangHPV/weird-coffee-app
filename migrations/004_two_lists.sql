-- The backlog is one flat task list: { "tasks": [ { id, text, created, done_at } ] }.
-- done_at is null while a task is on the TODO list.
ALTER TABLE public.backlog_state DROP CONSTRAINT IF EXISTS backlog_single_pending_batch;
ALTER TABLE public.backlog_state ALTER COLUMN document SET DEFAULT '{"tasks":[]}'::jsonb;

CREATE OR REPLACE FUNCTION public.save_backlog(expected_revision bigint, next_document jsonb)
RETURNS public.backlog_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner text := auth.user_id();
  current_row public.backlog_state%ROWTYPE;
  task jsonb;
  task_ids text[] := ARRAY[]::text[];
  identifier text;
BEGIN
  IF owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_snapshot WHERE id = 1 AND owner_id = owner
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF next_document IS NULL OR jsonb_typeof(next_document) <> 'object'
      OR jsonb_typeof(next_document->'tasks') IS DISTINCT FROM 'array'
      OR pg_column_size(next_document) > 400000
      OR jsonb_array_length(next_document->'tasks') > 2000 THEN
    RAISE EXCEPTION 'Invalid backlog' USING ERRCODE = '22023';
  END IF;
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
      RAISE EXCEPTION 'Invalid backlog task' USING ERRCODE = '22023';
    END IF;
    task_ids := array_append(task_ids, identifier);
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
