CREATE TABLE IF NOT EXISTS public.arena_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (mode IN ('anonymous', 'side_by_side', 'single')),
  model_a TEXT NOT NULL,
  model_b TEXT NOT NULL,
  response_a TEXT,
  response_b TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'voted', 'expired')),
  ip_hash TEXT,
  device_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

ALTER TABLE public.arena_matches
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (mode IN ('anonymous', 'side_by_side', 'single'));

CREATE TABLE IF NOT EXISTS public.arena_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.arena_matches(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  winner TEXT NOT NULL CHECK (winner IN ('a', 'b', 'tie', 'bad')),
  winning_model TEXT,
  losing_model TEXT,
  model_a TEXT NOT NULL,
  model_b TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  ip_hash TEXT,
  device_hash TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  effective BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.arena_model_stats (
  model_id TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  bad INTEGER NOT NULL DEFAULT 0,
  total_votes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.arena_abuse_counters (
  scope TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
  blocked_until TIMESTAMP WITH TIME ZONE,
  challenge_until TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cancri_turn_dedup (
  scope TEXT PRIMARY KEY,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_owner_updated ON public.arena_matches(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_matches_prompt_hash ON public.arena_matches(prompt_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_votes_owner_created ON public.arena_votes(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_votes_prompt_hash ON public.arena_votes(prompt_hash, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_votes_unique_owner_match ON public.arena_votes(match_id, owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_votes_unique_device_match ON public.arena_votes(match_id, device_hash) WHERE device_hash IS NOT NULL;

ALTER TABLE public.arena_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_model_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_abuse_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancri_turn_dedup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own arena matches" ON public.arena_matches;
DROP POLICY IF EXISTS "Users can view own arena votes" ON public.arena_votes;
DROP POLICY IF EXISTS "Anyone can view arena stats" ON public.arena_model_stats;

CREATE POLICY "Users can view own arena matches"
  ON public.arena_matches
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can view own arena votes"
  ON public.arena_votes
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Anyone can view arena stats"
  ON public.arena_model_stats
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.cancri_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_arena_matches_updated_at ON public.arena_matches;
CREATE TRIGGER update_arena_matches_updated_at
  BEFORE UPDATE ON public.arena_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.cancri_touch_updated_at();

CREATE OR REPLACE FUNCTION public.cancri_consume_abuse_token(
  p_scope TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER,
  p_block_seconds INTEGER DEFAULT 0
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_count INTEGER,
  retry_after_seconds INTEGER,
  blocked_until TIMESTAMP WITH TIME ZONE,
  reset_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_row public.arena_abuse_counters%ROWTYPE;
  v_window INTERVAL := make_interval(secs => GREATEST(p_window_seconds, 1));
  v_block INTERVAL := make_interval(secs => GREATEST(p_block_seconds, 0));
BEGIN
  INSERT INTO public.arena_abuse_counters(scope, count, reset_at, updated_at)
  VALUES (p_scope, 0, v_now + v_window, v_now)
  ON CONFLICT (scope) DO NOTHING;

  SELECT * INTO v_row
  FROM public.arena_abuse_counters
  WHERE scope = p_scope
  FOR UPDATE;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    allowed := FALSE;
    current_count := v_row.count;
    retry_after_seconds := CEIL(EXTRACT(EPOCH FROM (v_row.blocked_until - v_now)))::INTEGER;
    blocked_until := v_row.blocked_until;
    reset_at := v_row.reset_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_row.reset_at <= v_now THEN
    v_row.count := 0;
    v_row.reset_at := v_now + v_window;
    v_row.blocked_until := NULL;
  END IF;

  v_row.count := v_row.count + 1;

  IF v_row.count > GREATEST(p_limit, 1) THEN
    IF p_block_seconds > 0 THEN
      v_row.blocked_until := v_now + v_block;
    END IF;
    UPDATE public.arena_abuse_counters
    SET count = v_row.count,
        reset_at = v_row.reset_at,
        blocked_until = v_row.blocked_until,
        updated_at = v_now
    WHERE scope = p_scope;

    allowed := FALSE;
    current_count := v_row.count;
    retry_after_seconds := CEIL(EXTRACT(EPOCH FROM (COALESCE(v_row.blocked_until, v_row.reset_at) - v_now)))::INTEGER;
    blocked_until := v_row.blocked_until;
    reset_at := v_row.reset_at;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.arena_abuse_counters
  SET count = v_row.count,
      reset_at = v_row.reset_at,
      blocked_until = NULL,
      updated_at = v_now
  WHERE scope = p_scope;

  allowed := TRUE;
  current_count := v_row.count;
  retry_after_seconds := 0;
  blocked_until := NULL;
  reset_at := v_row.reset_at;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.cancri_consume_abuse_token(TEXT, INTEGER, INTEGER, INTEGER) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancri_mark_turn_once(
  p_scope TEXT,
  p_ttl_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  DELETE FROM public.cancri_turn_dedup
  WHERE expires_at < v_now;

  INSERT INTO public.cancri_turn_dedup(scope, expires_at, created_at)
  VALUES (p_scope, v_now + make_interval(secs => GREATEST(p_ttl_seconds, 1)), v_now)
  ON CONFLICT (scope) DO NOTHING;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.cancri_mark_turn_once(TEXT, INTEGER) TO anon, authenticated, service_role;
