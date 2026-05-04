ALTER TABLE public.arena_matches
  ADD COLUMN IF NOT EXISTS slot_a_turn_id UUID,
  ADD COLUMN IF NOT EXISTS slot_b_turn_id UUID,
  ADD COLUMN IF NOT EXISTS response_a_recorded_by_server BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS response_b_recorded_by_server BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slot_a_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS slot_b_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS slot_a_finished_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS slot_b_finished_at TIMESTAMP WITH TIME ZONE;

UPDATE public.arena_matches
SET slot_a_turn_id = gen_random_uuid()
WHERE slot_a_turn_id IS NULL;

UPDATE public.arena_matches
SET slot_b_turn_id = gen_random_uuid()
WHERE slot_b_turn_id IS NULL;

ALTER TABLE public.arena_matches
  ALTER COLUMN slot_a_turn_id SET NOT NULL,
  ALTER COLUMN slot_b_turn_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_arena_matches_server_recorded
  ON public.arena_matches(response_a_recorded_by_server, response_b_recorded_by_server, status);
