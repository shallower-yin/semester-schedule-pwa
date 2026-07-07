-- 为专注功能增加“锁机”记录类型。
-- 可重复执行；只调整校验约束，不修改已有记录。

alter table public.focus_sessions drop constraint if exists focus_sessions_mode_check;

alter table public.focus_sessions
  add constraint focus_sessions_mode_check
  check (mode in ('stopwatch', 'countdown', 'pomodoro', 'lock'));
