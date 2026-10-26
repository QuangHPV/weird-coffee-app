-- Phone relay: when the Mac's own requests are throttled, the admin's phone downloads a roaster's
-- feed on its own connection and uploads it here. The Mac reads the table directly, runs its
-- normal scan on the upload and sets applied_at.
BEGIN;

CREATE TABLE IF NOT EXISTS public.feed_uploads (
  roaster text PRIMARY KEY,
  pages jsonb NOT NULL,            -- {feed URL: response text}
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

ALTER TABLE public.feed_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feed_uploads FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.upload_feed(roaster_name text, feed_pages jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person text := auth.user_id();
BEGIN
  IF person IS NULL OR NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = person AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF roaster_name IS NULL OR length(roaster_name) > 100 OR feed_pages IS NULL
     OR jsonb_typeof(feed_pages) <> 'object' OR length(feed_pages::text) > 20000000 THEN
    RAISE EXCEPTION 'Invalid feed' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.feed_uploads(roaster, pages) VALUES (roaster_name, feed_pages)
    ON CONFLICT (roaster) DO UPDATE SET pages = EXCLUDED.pages, uploaded_at = now(), applied_at = NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.upload_feed(text, jsonb) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.upload_feed(text, jsonb) TO authenticated;

COMMIT;
