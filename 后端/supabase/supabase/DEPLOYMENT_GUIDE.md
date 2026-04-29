# 聊天记录持久化部署指南

## 1. 数据库迁移部署

由于未安装 Supabase CLI，需要手动在 Supabase Dashboard 中执行 SQL。

### 步骤：

1. 登录 Supabase Dashboard
2. 选择你的项目（diusqgphvybnzazgopor）
3. 进入 **SQL Editor**
4. 点击 **New Query**
5. 将 `migrations/create_chat_history.sql` 文件的内容复制粘贴到编辑器中
6. 点击 **Run** 执行 SQL

### SQL 文件位置：
`c:/Users/HP/Desktop/GitHub/css/后端/supabase/migrations/create_chat_history.sql`

## 2. Edge Function 部署

### 方法 1：使用 Supabase CLI（推荐）

如果安装了 Supabase CLI：

```bash
# 进入项目目录
cd c:/Users/HP/Desktop/GitHub/css/后端/supabase

# 链接到你的 Supabase 项目
supabase link --project-ref diusqgphvybnzazgopor

# 部署 Edge Function
supabase functions deploy chat-history
```

### 方法 2：通过 Dashboard 部署

1. 登录 Supabase Dashboard
2. 进入 **Edge Functions**
3. 点击 **New Function**
4. 函数名称填写：`chat-history`
5. 将 `functions/chat-history/index.ts` 的内容复制粘贴到编辑器中
6. 点击 **Deploy**

### Edge Function 文件位置：
`c:/Users/HP/Desktop/GitHub/css/后端/supabase/functions/chat-history/index.ts`

## 3. 环境变量设置

确保 Supabase Edge Function 中设置了以下环境变量：

- `SUPABASE_URL` = `https://diusqgphvybnzazgopor.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = （从 Dashboard → Settings → API 获取 service_role key）

## 4. 测试

部署完成后，刷新聊天页面，发送消息会自动保存到 Supabase。

检查浏览器控制台是否有错误信息。
