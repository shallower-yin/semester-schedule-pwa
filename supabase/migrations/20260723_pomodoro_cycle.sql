alter table public.focus_settings
  add column if not exists pomodoro_rounds integer not null default 4,
  add column if not exists long_break_minutes integer not null default 15,
  add column if not exists long_break_interval integer not null default 4,
  add column if not exists auto_start_break boolean not null default true;

alter table public.focus_sessions
  add column if not exists pomodoro_plan_id text,
  add column if not exists pomodoro_round integer;

alter table public.rest_sessions
  add column if not exists rest_kind text not null default 'manual',
  add column if not exists pomodoro_plan_id text,
  add column if not exists pomodoro_round integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'focus_settings_pomodoro_rounds_check') then
    alter table public.focus_settings add constraint focus_settings_pomodoro_rounds_check check (pomodoro_rounds between 1 and 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'focus_settings_long_break_minutes_check') then
    alter table public.focus_settings add constraint focus_settings_long_break_minutes_check check (long_break_minutes between 1 and 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'focus_settings_long_break_interval_check') then
    alter table public.focus_settings add constraint focus_settings_long_break_interval_check check (long_break_interval between 1 and 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'focus_sessions_pomodoro_round_check') then
    alter table public.focus_sessions add constraint focus_sessions_pomodoro_round_check check (pomodoro_round is null or pomodoro_round > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rest_sessions_pomodoro_round_check') then
    alter table public.rest_sessions add constraint rest_sessions_pomodoro_round_check check (pomodoro_round is null or pomodoro_round > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rest_sessions_rest_kind_check') then
    alter table public.rest_sessions add constraint rest_sessions_rest_kind_check check (rest_kind in ('manual', 'pomodoro_short', 'pomodoro_long'));
  end if;
end
$$;
