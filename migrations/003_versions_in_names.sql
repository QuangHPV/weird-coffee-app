-- Preserve existing version labels in the editable bucket name.
UPDATE public.backlog_state AS state
SET document = jsonb_set(state.document, '{buckets}', (
  SELECT jsonb_agg(CASE WHEN trim(coalesce(bucket->>'version', '')) <> '' THEN
    bucket || jsonb_build_object(
      'title', CASE WHEN right(lower(bucket->>'title'),
        length('v' || regexp_replace(trim(bucket->>'version'), '^[vV]', ''))) =
        lower('v' || regexp_replace(trim(bucket->>'version'), '^[vV]', ''))
      THEN bucket->>'title'
      ELSE left(bucket->>'title', 137) || ' v' || regexp_replace(trim(bucket->>'version'), '^[vV]', '') END,
      'version', '')
    ELSE bucket END ORDER BY position)
  FROM jsonb_array_elements(state.document->'buckets') WITH ORDINALITY AS entry(bucket, position)
)), revision = revision + 1, updated_at = now()
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(state.document->'buckets') AS bucket
  WHERE trim(coalesce(bucket->>'version', '')) <> '');
