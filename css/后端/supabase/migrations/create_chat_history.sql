-- 创建聊天记录表
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- 用户标识（基于 API key 或 session）
  title TEXT NOT NULL DEFAULT '新对话', -- 对话标题
  messages JSONB NOT NULL DEFAULT '[]'::jsonb, -- 消息列表
  model TEXT NOT NULL DEFAULT 'deepseek-v4', -- 使用的模型
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at DESC);

-- 启用行级安全策略
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的聊天记录
CREATE POLICY "Users can view own chat history"
  ON chat_history FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true));

-- 用户可以创建自己的聊天记录
CREATE POLICY "Users can create own chat history"
  ON chat_history FOR INSERT
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

-- 用户可以更新自己的聊天记录
CREATE POLICY "Users can update own chat history"
  ON chat_history FOR UPDATE
  USING (user_id = current_setting('app.current_user_id', true));

-- 用户可以删除自己的聊天记录
CREATE POLICY "Users can delete own chat history"
  ON chat_history FOR DELETE
  USING (user_id = current_setting('app.current_user_id', true));

-- 自动更新 updated_at 时间戳
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_chat_history_updated_at
  BEFORE UPDATE ON chat_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
