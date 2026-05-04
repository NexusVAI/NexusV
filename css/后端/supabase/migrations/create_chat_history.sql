-- Chat history storage for verified Supabase Auth users.
CREATE TABLE IF NOT EXISTS public.chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id TEXT,
  title TEXT NOT NULL DEFAULT '新对话',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.chat_history
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '新对话',
  ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_chat_history_owner_id ON public.chat_history(owner_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_updated_at ON public.chat_history(updated_at DESC);

ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Users can create own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Users can update own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Users can delete own chat history" ON public.chat_history;

CREATE POLICY "Users can view own chat history"
  ON public.chat_history
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can create own chat history"
  ON public.chat_history
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own chat history"
  ON public.chat_history
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete own chat history"
  ON public.chat_history
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_chat_history_updated_at ON public.chat_history;
CREATE TRIGGER update_chat_history_updated_at
  BEFORE UPDATE ON public.chat_history
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
