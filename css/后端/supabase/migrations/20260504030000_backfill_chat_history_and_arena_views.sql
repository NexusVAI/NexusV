-- Preserve older chat rows after owner_id became the RLS authority.
UPDATE public.chat_history
SET owner_id = user_id::uuid
WHERE owner_id IS NULL
  AND user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.chat_history
SET owner_id = substring(user_id from 6)::uuid
WHERE owner_id IS NULL
  AND user_id ~* '^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

CREATE OR REPLACE VIEW public.arena_effective_votes
WITH (security_invoker = true)
AS
SELECT *
FROM public.arena_votes
WHERE effective = true;

CREATE OR REPLACE VIEW public.arena_public_leaderboard
WITH (security_invoker = true)
AS
SELECT *
FROM public.arena_model_stats
ORDER BY elo_score DESC, total_votes DESC;

GRANT SELECT ON public.arena_effective_votes TO authenticated;
GRANT SELECT ON public.arena_public_leaderboard TO anon, authenticated;
