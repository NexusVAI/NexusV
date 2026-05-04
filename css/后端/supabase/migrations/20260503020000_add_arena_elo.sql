ALTER TABLE public.arena_model_stats
  ADD COLUMN IF NOT EXISTS elo_score NUMERIC NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS elo_games INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.arena_votes
  ADD COLUMN IF NOT EXISTS model_a_elo_before NUMERIC,
  ADD COLUMN IF NOT EXISTS model_b_elo_before NUMERIC,
  ADD COLUMN IF NOT EXISTS model_a_elo_after NUMERIC,
  ADD COLUMN IF NOT EXISTS model_b_elo_after NUMERIC;

CREATE INDEX IF NOT EXISTS idx_arena_model_stats_elo ON public.arena_model_stats(elo_score DESC, total_votes DESC);
