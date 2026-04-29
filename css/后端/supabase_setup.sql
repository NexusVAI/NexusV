-- 创建API配置表
CREATE TABLE IF NOT EXISTS api_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service_name TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 启用行级安全
ALTER TABLE api_config ENABLE ROW LEVEL SECURITY;

-- 删除旧策略（如果存在）并创建新策略：只允许通过服务端函数访问
DROP POLICY IF EXISTS "No direct access" ON api_config;
CREATE POLICY "No direct access" ON api_config FOR ALL
  USING (false);

-- 插入ModelScope API Key（请替换为实际密钥）
INSERT INTO api_config (service_name, api_key)
VALUES ('modelscope', 'YOUR_MODELSCOPE_API_KEY')
ON CONFLICT (service_name) DO UPDATE SET
  api_key = EXCLUDED.api_key,
  updated_at = NOW();

