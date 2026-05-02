# AI 服务状态监控

简约 OpenAI 风格的服务状态页面。

## 使用方法

1. **部署到 GitHub Pages**
   - 推送代码到 GitHub 仓库
   - 在 Settings > Pages 中启用 GitHub Pages

2. **手动更新状态**
   
   编辑 `status.json` 文件：
   
   ```json
   {
     "lastUpdated": "2026-04-30T20:43:00+08:00",
     "services": [
       {
         "name": "服务名称",
         "description": "服务描述",
         "status": "operational"
       }
     ]
   }
   ```
   
   `status` 可选值：
   - `operational` - 正常运行（绿色）
   - `degraded` - 性能降级（黄色）
   - `down` - 服务中断（红色）

## 特点

- 纯静态页面，无需后端
- 极简设计，大量留白
- 自动刷新（60秒）
- 响应式布局
- 仅黑白灰 + 状态指示色
