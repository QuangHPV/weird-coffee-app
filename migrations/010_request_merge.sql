-- Merge a feature request into a planned task: completing the task completes the request,
-- members see "Part of: <task>", and the Mac sends one completion notification per request.
BEGIN;

ALTER TABLE public.feature_requests ADD COLUMN merged_title text;
ALTER TABLE public.feature_requests ADD COLUMN notified_at timestamptz;
-- Requests finished before this migration are not announced.
UPDATE public.feature_requests SET notified_at = COALESCE(completed_at, now()) WHERE status = 'completed';
GRANT SELECT (merged_title) ON public.feature_requests TO authenticated;

-- A task with `merged_into` follows the task it points to: when that one is done, so is this one.
CREATE FUNCTION public.propagate_merged_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.document := NEW.document || jsonb_build_object('tasks', COALESCE((
    SELECT jsonb_agg(
      CASE WHEN task ? 'merged_into' AND task->>'done_at' IS NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(NEW.document->'tasks') target
          WHERE target->>'id' = task->>'merged_into' AND target->>'done_at' IS NOT NULL)
        THEN jsonb_set(task, '{done_at}', (SELECT target->'done_at' FROM jsonb_array_elements(NEW.document->'tasks') target
          WHERE target->>'id' = task->>'merged_into'))
        ELSE task END ORDER BY position)
    FROM jsonb_array_elements(NEW.document->'tasks') WITH ORDINALITY item(task, position)), '[]'::jsonb));
  RETURN NEW;
END;
$$;
CREATE TRIGGER backlog_merged_completion BEFORE UPDATE OF document ON public.backlog_state
  FOR EACH ROW EXECUTE FUNCTION public.propagate_merged_completion();

-- Also copy the target's short title (the text before a colon) to the request for members.
CREATE OR REPLACE FUNCTION public.sync_request_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.feature_requests f SET
    status = CASE WHEN task.value->>'done_at' IS NULL THEN 'requested' ELSE 'completed' END,
    completed_at = (task.value->>'done_at')::timestamptz
    FROM jsonb_array_elements(NEW.document->'tasks') task(value)
    WHERE task.value ? 'request_id' AND f.id::text = task.value->>'request_id'
      AND (f.status IS DISTINCT FROM CASE WHEN task.value->>'done_at' IS NULL THEN 'requested' ELSE 'completed' END
        OR f.completed_at IS DISTINCT FROM (task.value->>'done_at')::timestamptz);
  UPDATE public.feature_requests f SET merged_title = m.title
    FROM (SELECT task->>'request_id' AS request_id,
            (SELECT NULLIF(btrim(regexp_replace(split_part(split_part(target->>'text', E'\n', 1), ':', 1), '#\S+', '', 'g')), '')
               FROM jsonb_array_elements(NEW.document->'tasks') target WHERE target->>'id' = task->>'merged_into') AS title
          FROM jsonb_array_elements(NEW.document->'tasks') task WHERE task ? 'request_id') m
    WHERE f.id::text = m.request_id AND f.merged_title IS DISTINCT FROM m.title;
  RETURN NEW;
END;
$$;

-- save_backlog keeps whatever fields the task has, so `merged_into` passes through for the admin.
COMMIT;
