-- Phone push notifications: the app saves its browser push subscription here, and the Mac
-- (which reads the table directly) sends a notification after a refresh finds something.
BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  owner_id text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner text := auth.user_id();
BEGIN
  IF owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_snapshot WHERE id = 1 AND owner_id = owner
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_subscriptions(owner_id, endpoint, p256dh, auth_key)
    VALUES (owner, sub_endpoint, sub_p256dh, sub_auth)
    ON CONFLICT (owner_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth_key = EXCLUDED.auth_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_push_subscription(sub_endpoint text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner text := auth.user_id();
BEGIN
  IF owner IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.push_subscriptions WHERE owner_id = owner AND endpoint = sub_endpoint;
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.remove_push_subscription(text) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_push_subscription(text) TO authenticated;

COMMIT;
