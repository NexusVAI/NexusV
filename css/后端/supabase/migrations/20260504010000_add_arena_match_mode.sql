ALTER TABLE public.arena_matches
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'anonymous'
  CHECK (mode IN ('anonymous', 'side_by_side', 'single'));
