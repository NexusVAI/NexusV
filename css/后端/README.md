# Supabase后端部署指南

## 1. 在Supabase中执行SQL脚本

在Supabase Dashboard的SQL Editor中执行 `supabase_setup.sql`，这将：
- 创建 `api_config` 表存储API key
- 启用行级安全保护
- 插入ModelScope API key
- API key 通过 Edge Function 环境变量直接配置，不再通过数据库函数暴露

## 2. 部署Edge Function

### 安装Supabase CLI
```bash
npm install -g supabase
```

### 登录并链接项目
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 部署Edge Function
```bash
supabase functions deploy modelscope-proxy
```

## 3. 设置环境变量

在Supabase Dashboard中设置Edge Function的环境变量：
- `SUPABASE_URL`: https://YOUR_PROJECT_REF.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`: 你的Supabase service_role key
- `MODELSCOPE_API_KEY`: 你的ModelScope API key（直接从环境变量读取，不再通过数据库函数暴露）

## 4. 测试Edge Function

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/modelscope-proxy \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "chat",
    "model": "deepseek-ai/DeepSeek-V4-Flash",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 5. 前端配置

修改前端代码，将API调用指向Edge Function：
- 将 `https://api-inference.modelscope.cn/v1` 替换为Edge Function URL
- 移除前端硬编码的API key
