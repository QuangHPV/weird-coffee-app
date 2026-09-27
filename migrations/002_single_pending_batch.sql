-- One pending batch, enforced for both the Data API and the Mac writer.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.backlog_state'::regclass
      AND conname = 'backlog_single_pending_batch') THEN
    ALTER TABLE public.backlog_state ADD CONSTRAINT backlog_single_pending_batch
      CHECK (jsonb_array_length(jsonb_path_query_array(document,
        '$.buckets[*] ? (@.stage == "pending")')) <= 1);
  END IF;
END $$;
