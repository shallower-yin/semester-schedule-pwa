# Supabase 接入状态

项目地址已经写入本机 `.env.local`，Publishable key 仅用于浏览器客户端。业务表、同步触发器和 RLS 已在 Supabase 执行。

## 数据库升级

首次安装执行 `supabase/schema.sql`。后续版本再按文件名顺序执行 `supabase/migrations/` 中尚未执行的 SQL。

当前需要执行：

`supabase/migrations/20260705_flexible_schedule_and_reminders.sql`

该迁移保留已有学期、课程和事项，增加灵活时间块、提醒字段、推送订阅表及受令牌保护的后台提醒函数。

如果主迁移在 2026-07-05 早期版本中已经执行，还需补充执行：

`supabase/migrations/20260705_fix_reminder_token_digest.sql`

该修复只调整提醒函数访问 `pgcrypto` 的搜索路径，不修改业务数据。

如果后台工作流提示 `event_id is ambiguous`，再执行：

`supabase/migrations/20260705_fix_reminder_claim_conflict.sql`

该修复仅替换提醒领取函数，改用唯一约束名称处理重复提醒。

纪念日、生日和节日功能需要执行：

`supabase/migrations/20260707_anniversaries.sql`

该迁移新增纪念日表，并把后台提醒函数扩展为同时领取事项提醒和纪念日提醒。

事项日期范围和习惯功能需要执行：

`supabase/migrations/20260708_event_ranges_and_habits.sql`

该迁移给事项表增加 `event_type` 字段，支持 `event` 和 `habit` 两类记录，并把后台提醒函数调整为按事项开始日期到结束日期逐日领取提醒。

事项重复规则增强需要执行：

`supabase/migrations/20260708_recurrence_rules.sql`

该迁移给事项表增加 `recurrence_interval` 字段，允许 `daily`、`weekdays`、`weekly`、`monthly`、`interval` 重复规则，并同步更新后台提醒领取函数。执行后，工作日、每月同日和自定义间隔事项/习惯才能在云端后台提醒中正确领取。

AI 助手权限需要执行：

`supabase/migrations/20260708_ai_assistant_access.sql`

该迁移新增 `ai_assistant_access` 表。只有表中启用的账号，或输入 Edge Function Secret `AI_ASSISTANT_ACCESS_CODE` 的用户，可以使用 AI 助手。已配置服务端角色密钥时，访问口令验证成功会自动把当前账号写入权限表，之后同账号可不再输入口令。

## Auth URL 配置

在 Supabase Dashboard 打开 `Authentication → URL Configuration`：

- 本地测试 Site URL：`http://127.0.0.1:5173`
- Redirect URLs：
  - `http://127.0.0.1:5173/**`
  - `http://localhost:5173/**`
  - `https://shallower-yin.github.io/semester-schedule-pwa/**`

正式 Site URL：`https://shallower-yin.github.io/semester-schedule-pwa/`

## 首次账号测试

1. 双击 `启动日程.cmd`。
2. 点击右上角“登录并同步”。
3. 选择“注册账号”，填写真实邮箱和至少六位密码。
4. 打开验证邮件并完成确认。
5. 返回应用登录，点击“立即同步”。
6. 右上角待同步数量应归零。
7. 编辑事项并开启“提醒我”，浏览器询问时选择允许。

首次登录会把现有 `user_id = local` 的 IndexedDB 数据归属到登录账号并上传。退出登录后，界面不会显示该账号的缓存数据；重新登录后恢复。

## 安全规则

- 网页中只能使用 Publishable key。
- AI 服务 API Key 只能保存为 Supabase Edge Function Secret `DEEPSEEK_API_KEY`，不要写进前端 `.env.local`。
- 管理后台需要服务端角色密钥，只能放在 GitHub Secret / Supabase Edge Function Secret，绝对不要写进前端或公开文档。GitHub Secret 使用 `SUPABASE_SERVICE_ROLE_KEY`，部署脚本会写入 Supabase Edge Function Secret `SERVICE_ROLE_KEY`。
- GitHub 后台提醒任务需要 Legacy API Keys 中的 `anon` key，并将其保存为仓库 Secret `SUPABASE_ANON_KEY`；不要使用 `service_role`。
- 不要把 Secret key、`service_role`、数据库密码放入 `.env.local` 或发给他人。
- 所有业务表启用 RLS，策略限定 `auth.uid() = user_id`。
- 应用内删除采用硬删除，并通过同步队列删除云端对应记录；历史 `deleted_at` 记录会在同步时清理。
- Supabase Auth 负责账号凭据托管，应用不保存密码原文；管理员只能重置、删除或禁用账号。

## AI 助手

需要在 GitHub Secrets / Variables 中配置：

- Secret `DEEPSEEK_API_KEY`：AI 服务 API Key。
- Secret `AI_ASSISTANT_ACCESS_CODE`：可选，给用户输入的访问口令；验证成功后会自动绑定当前账号为会员权限。
- GitHub Secret `SUPABASE_SERVICE_ROLE_KEY`：管理后台读取用户列表和业务数据需要。该值来自 Supabase Dashboard 的 Project Settings → API，只能保存为 Secret。部署时会同步为 Edge Function Secret `SERVICE_ROLE_KEY`，因为 Supabase 不允许自定义 Secret 名以 `SUPABASE_` 开头。
- Variable `DEEPSEEK_MODEL`：可选，AI 服务参数配置。

给指定账号开通：

```sql
insert into public.ai_assistant_access (user_id, enabled, role, expires_at, note)
values ('用户 UUID', true, 'member', null, 'AI 助手开通')
on conflict (user_id) do update
set enabled = excluded.enabled,
    role = excluded.role,
    expires_at = excluded.expires_at,
    note = excluded.note,
    updated_at = now();
```

设置管理员账号：

```sql
insert into public.ai_assistant_access (user_id, enabled, role, note)
values ('你的用户 UUID', true, 'admin', '管理员')
on conflict (user_id) do update
set enabled = true,
    role = 'admin',
    updated_at = now();
```

设置完成并部署 Edge Function 后，管理员账号在“设置”中会看到“管理后台”。后台可查看账号邮箱、注册时间、最近登录时间、数据数量和具体日程/习惯/纪念日/备忘录/专注记录，并可给指定用户开通或关闭 AI 助手、设置会员到期时间、设置管理员角色。

账号凭据由 Supabase Auth 托管，应用数据库只保存业务数据；前端仍受 RLS 保护，跨用户查看只通过 `admin` Edge Function 使用 service role 完成。
