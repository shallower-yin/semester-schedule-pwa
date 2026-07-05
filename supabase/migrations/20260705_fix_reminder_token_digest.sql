-- 修复已执行提醒迁移的项目：Supabase 将 pgcrypto.digest 放在 extensions schema。
-- 仅调整两个后台函数的运行时搜索路径，不修改任何业务数据。

alter function public.claim_due_reminders(text)
  set search_path = public, extensions, pg_temp;

alter function public.complete_reminder_delivery(text, uuid, boolean, text, text[])
  set search_path = public, extensions, pg_temp;
