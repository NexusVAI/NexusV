CREATE OR REPLACE FUNCTION public.cancri_apply_arena_vote(
  p_match_id UUID,
  p_owner_id UUID,
  p_winner TEXT,
  p_ip_hash TEXT,
  p_device_hash TEXT,
  p_risk_score INTEGER,
  p_effective BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.arena_matches%ROWTYPE;
  v_vote public.arena_votes%ROWTYPE;
  v_effective BOOLEAN;
  v_winning_model TEXT;
  v_losing_model TEXT;
  v_a_before NUMERIC := 1000;
  v_b_before NUMERIC := 1000;
  v_a_after NUMERIC := 1000;
  v_b_after NUMERIC := 1000;
  v_score_a NUMERIC := 0;
  v_score_b NUMERIC := 0;
  v_expected_a NUMERIC := 0;
  v_expected_b NUMERIC := 0;
  v_count_elo_game INTEGER := 0;
BEGIN
  IF p_winner NOT IN ('a', 'b', 'tie', 'bad') THEN
    RAISE EXCEPTION 'invalid_vote';
  END IF;

  SELECT *
  INTO v_match
  FROM public.arena_matches
  WHERE id = p_match_id
    AND owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'arena_match_not_found';
  END IF;

  IF v_match.status <> 'answered' THEN
    RAISE EXCEPTION 'match_not_answered';
  END IF;

  IF v_match.response_a IS NULL OR v_match.response_b IS NULL THEN
    RAISE EXCEPTION 'missing_responses';
  END IF;

  v_effective :=
    COALESCE(p_effective, FALSE)
    AND v_match.mode = 'anonymous'
    AND v_match.response_a_recorded_by_server
    AND v_match.response_b_recorded_by_server
    AND COALESCE(p_risk_score, 0) < 70;

  v_winning_model := CASE
    WHEN p_winner = 'a' THEN v_match.model_a
    WHEN p_winner = 'b' THEN v_match.model_b
    ELSE NULL
  END;
  v_losing_model := CASE
    WHEN p_winner = 'a' THEN v_match.model_b
    WHEN p_winner = 'b' THEN v_match.model_a
    ELSE NULL
  END;

  INSERT INTO public.arena_votes (
    match_id,
    owner_id,
    winner,
    winning_model,
    losing_model,
    model_a,
    model_b,
    prompt_hash,
    ip_hash,
    device_hash,
    risk_score,
    effective,
    reason
  )
  VALUES (
    v_match.id,
    p_owner_id,
    p_winner,
    v_winning_model,
    v_losing_model,
    v_match.model_a,
    v_match.model_b,
    v_match.prompt_hash,
    p_ip_hash,
    p_device_hash,
    COALESCE(p_risk_score, 0),
    v_effective,
    NULLIF(p_reason, '')
  )
  RETURNING * INTO v_vote;

  UPDATE public.arena_matches
  SET status = 'voted'
  WHERE id = v_match.id
    AND owner_id = p_owner_id;

  SELECT COALESCE((SELECT elo_score FROM public.arena_model_stats WHERE model_id = v_match.model_a), 1000)
  INTO v_a_before;
  SELECT COALESCE((SELECT elo_score FROM public.arena_model_stats WHERE model_id = v_match.model_b), 1000)
  INTO v_b_before;
  v_a_after := v_a_before;
  v_b_after := v_b_before;

  IF v_effective THEN
    INSERT INTO public.arena_model_stats(model_id)
    VALUES (v_match.model_a), (v_match.model_b)
    ON CONFLICT (model_id) DO NOTHING;

    PERFORM 1
    FROM public.arena_model_stats
    WHERE model_id IN (v_match.model_a, v_match.model_b)
    ORDER BY model_id
    FOR UPDATE;

    SELECT elo_score INTO v_a_before
    FROM public.arena_model_stats
    WHERE model_id = v_match.model_a;
    SELECT elo_score INTO v_b_before
    FROM public.arena_model_stats
    WHERE model_id = v_match.model_b;

    IF p_winner IN ('a', 'b', 'tie') THEN
      v_score_a := CASE WHEN p_winner = 'a' THEN 1 WHEN p_winner = 'b' THEN 0 ELSE 0.5 END;
      v_score_b := 1 - v_score_a;
      v_expected_a := 1 / (1 + POWER(10::NUMERIC, (v_b_before - v_a_before) / 400));
      v_expected_b := 1 / (1 + POWER(10::NUMERIC, (v_a_before - v_b_before) / 400));
      v_a_after := ROUND((v_a_before + 32 * (v_score_a - v_expected_a)) * 10) / 10;
      v_b_after := ROUND((v_b_before + 32 * (v_score_b - v_expected_b)) * 10) / 10;
      v_count_elo_game := 1;
    END IF;

    UPDATE public.arena_model_stats
    SET wins = wins + CASE WHEN p_winner = 'a' THEN 1 ELSE 0 END,
        losses = losses + CASE WHEN p_winner = 'b' THEN 1 ELSE 0 END,
        ties = ties + CASE WHEN p_winner = 'tie' THEN 1 ELSE 0 END,
        bad = bad + CASE WHEN p_winner = 'bad' THEN 1 ELSE 0 END,
        total_votes = total_votes + 1,
        elo_score = v_a_after,
        elo_games = elo_games + v_count_elo_game,
        updated_at = NOW()
    WHERE model_id = v_match.model_a;

    UPDATE public.arena_model_stats
    SET wins = wins + CASE WHEN p_winner = 'b' THEN 1 ELSE 0 END,
        losses = losses + CASE WHEN p_winner = 'a' THEN 1 ELSE 0 END,
        ties = ties + CASE WHEN p_winner = 'tie' THEN 1 ELSE 0 END,
        bad = bad + CASE WHEN p_winner = 'bad' THEN 1 ELSE 0 END,
        total_votes = total_votes + 1,
        elo_score = v_b_after,
        elo_games = elo_games + v_count_elo_game,
        updated_at = NOW()
    WHERE model_id = v_match.model_b;

    UPDATE public.arena_votes
    SET model_a_elo_before = v_a_before,
        model_b_elo_before = v_b_before,
        model_a_elo_after = v_a_after,
        model_b_elo_after = v_b_after
    WHERE id = v_vote.id
    RETURNING * INTO v_vote;
  END IF;

  RETURN jsonb_build_object(
    'vote', to_jsonb(v_vote),
    'effective', v_effective,
    'reveal', jsonb_build_object(
      'model_a', v_match.model_a,
      'model_b', v_match.model_b,
      'model_a_elo_before', v_a_before,
      'model_b_elo_before', v_b_before,
      'model_a_elo_after', v_a_after,
      'model_b_elo_after', v_b_after
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancri_apply_arena_vote(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancri_apply_arena_vote(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, TEXT) TO service_role;
