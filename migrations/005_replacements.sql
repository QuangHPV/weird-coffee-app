-- Replacement suggestions: the Mac publishes pending "same lot, new listing" pairs in
-- app_snapshot.payload->'suggestions'. The phone accepts or rejects one here; the Mac
-- picks the decision up (applied_at stays null until it has) and updates its own data.
-- Accepting also moves the old listing's Wish list place to the new one in the same call.
BEGIN;

CREATE TABLE IF NOT EXISTS public.replacement_decisions (
  owner_id text NOT NULL,
  old_id text NOT NULL,
  new_id text NOT NULL,
  accepted boolean NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  PRIMARY KEY (owner_id, old_id, new_id)
);

ALTER TABLE public.replacement_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.replacement_decisions FROM PUBLIC, anonymous, authenticated;
GRANT SELECT ON public.replacement_decisions TO authenticated;
CREATE POLICY owner_decisions_read ON public.replacement_decisions FOR SELECT TO authenticated
  USING (owner_id = (select auth.user_id()));

CREATE OR REPLACE FUNCTION public.decide_replacement(old_listing text, new_listing text, do_accept boolean)
RETURNS public.wishlist_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner text := auth.user_id();
  current_row public.wishlist_state%ROWTYPE;
BEGIN
  IF owner IS NULL OR do_accept IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_snapshot WHERE id = 1 AND owner_id = owner
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- Only a pair the Mac published as pending can be decided.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (SELECT payload->'suggestions' FROM public.app_snapshot WHERE id = 1 AND owner_id = owner)
    ) s WHERE s->>'old_id' = old_listing AND s->>'new_id' = new_listing
  ) THEN
    RAISE EXCEPTION 'Unknown replacement' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.replacement_decisions(owner_id, old_id, new_id, accepted)
    VALUES (owner, old_listing, new_listing, do_accept)
    ON CONFLICT (owner_id, old_id, new_id) DO NOTHING;
  SELECT * INTO current_row FROM public.wishlist_state WHERE owner_id = owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wish list has not been initialized' USING ERRCODE = '42501';
  END IF;
  IF do_accept AND current_row.ids ? old_listing THEN
    UPDATE public.wishlist_state SET ids = (
        SELECT COALESCE(jsonb_agg(d.v ORDER BY d.ord), '[]'::jsonb) FROM (
          SELECT DISTINCT ON (m.v) m.v, m.ord FROM (
            SELECT CASE WHEN e.value = to_jsonb(old_listing) THEN to_jsonb(new_listing) ELSE e.value END AS v, e.ord
            FROM jsonb_array_elements(current_row.ids) WITH ORDINALITY AS e(value, ord)
          ) m ORDER BY m.v, m.ord
        ) d),
      revision = revision + 1, updated_at = now()
      WHERE owner_id = owner RETURNING * INTO current_row;
  END IF;
  RETURN current_row;
END;
$$;
REVOKE ALL ON FUNCTION public.decide_replacement(text, text, boolean) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.decide_replacement(text, text, boolean) TO authenticated;

COMMIT;
