CREATE OR REPLACE FUNCTION public.cancri_canonical_model_id(model_id TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE model_id
    WHEN 'deepseek-v4-pro-alt' THEN 'deepseek-v4-pro'
    WHEN 'kimi-k2.6-alt' THEN 'kimi-k2.6'
    WHEN 'kimi-k2.6-extended' THEN 'kimi-k2.6'
    WHEN 'kimi-k2.5-alt' THEN 'kimi-k2.5'
    WHEN 'minimax-m2.5-alt' THEN 'minimax-m2.5'
    WHEN 'ling-2.6-1t-alt' THEN 'ling-2.6-1t'
    WHEN 'glm-5.1-alt' THEN 'glm-5.1'
    ELSE model_id
  END
$$;

CREATE OR REPLACE VIEW public.arena_public_leaderboard
WITH (security_invoker = true)
AS
WITH model_meta(model_id, canonical_id, line_label, display_name, brand, arena_enabled) AS (
  VALUES
    ('grok-4.20-fast', 'grok-4.20-fast', '线路一', 'Grok 4.20 Fast', 'Grok', TRUE),
    ('minimax-m2.7', 'minimax-m2.7', '线路一', 'MiniMax M2.7', 'MiniMax', TRUE),
    ('step-3.5-flash', 'step-3.5-flash', '线路一', 'Step-3.5', '阶跃星辰', TRUE),
    ('deepseek-r1', 'deepseek-r1', '线路一', 'DeepSeek-R1', 'DeepSeek', TRUE),
    ('glm-5', 'glm-5', '线路一', 'GLM-5', '智谱 GLM', TRUE),
    ('qwen3.6-plus', 'qwen3.6-plus', '线路一', 'Qwen3.6 Plus', '通义千问', TRUE),
    ('qwen3-max', 'qwen3-max', '线路一', 'Qwen3-Max', '通义千问', TRUE)
),
candidate_lines AS (
  SELECT
    s.*,
    COALESCE(m.canonical_id, public.cancri_canonical_model_id(s.model_id)) AS canonical_id,
    COALESCE(m.line_label, '线路一') AS line_label,
    COALESCE(m.display_name, s.model_id) AS display_name,
    COALESCE(m.brand, '') AS brand
  FROM public.arena_model_stats s
  JOIN model_meta m ON m.model_id = s.model_id
  WHERE m.arena_enabled = TRUE
),
best_lines AS (
  SELECT *
  FROM (
    SELECT
      candidate_lines.*,
      ROW_NUMBER() OVER (
        PARTITION BY canonical_id
        ORDER BY elo_score DESC, total_votes DESC, updated_at DESC, model_id ASC
      ) AS canonical_line_rank
    FROM candidate_lines
  ) ranked_lines
  WHERE canonical_line_rank = 1
),
ranked AS (
  SELECT
    best_lines.*,
    ROW_NUMBER() OVER (ORDER BY elo_score DESC, total_votes DESC, updated_at DESC, canonical_id ASC) AS rank,
    GREATEST(8, ROUND(32 / SQRT(elo_games + 1)))::INTEGER AS elo_delta
  FROM best_lines
)
SELECT
  canonical_id AS model_id,
  ranked.model_id AS best_line_model_id,
  line_label,
  display_name,
  brand,
  wins,
  losses,
  ties,
  bad,
  total_votes,
  elo_score,
  elo_games,
  updated_at,
  CASE WHEN total_votes > 0 THEN ROUND((wins::NUMERIC / total_votes::NUMERIC) * 1000) / 10 ELSE 0 END AS win_rate,
  rank,
  (
    SELECT MIN(other.rank)
    FROM ranked other
    WHERE ABS(other.elo_score - ranked.elo_score) <= ranked.elo_delta
  ) AS rank_spread_low,
  (
    SELECT MAX(other.rank)
    FROM ranked other
    WHERE ABS(other.elo_score - ranked.elo_score) <= ranked.elo_delta
  ) AS rank_spread_high,
  elo_delta
FROM ranked;

GRANT EXECUTE ON FUNCTION public.cancri_canonical_model_id(TEXT) TO anon, authenticated;
GRANT SELECT ON public.arena_public_leaderboard TO anon, authenticated;
