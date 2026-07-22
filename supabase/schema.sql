-- 日程计划表：Supabase PostgreSQL schema
-- 在 Supabase Dashboard -> SQL Editor 中完整执行一次。

create extension if not exists pgcrypto;

create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  start_date date not null,
  total_weeks smallint not null check (total_weeks between 1 and 60),
  is_current boolean not null default false,
  unique (id, user_id)
);

create table if not exists public.class_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  semester_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  period_number smallint not null check (period_number between 1 and 24),
  name text not null check (char_length(name) between 1 and 50),
  start_time time not null,
  end_time time not null,
  unique (id, user_id),
  foreign key (semester_id, user_id) references public.semesters(id, user_id)
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  semester_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  teacher text not null default '',
  classroom text not null default '',
  color text not null default '#5b78df',
  note text not null default '',
  unique (id, user_id),
  foreign key (semester_id, user_id) references public.semesters(id, user_id)
);

create table if not exists public.course_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  course_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_period smallint not null check (start_period between 1 and 24),
  end_period smallint not null check (end_period between start_period and 24),
  weeks smallint[] not null check (coalesce(array_length(weeks, 1), 0) > 0),
  unique (id, user_id),
  foreign key (course_id, user_id) references public.courses(id, user_id)
);

create table if not exists public.course_cancellations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  course_schedule_id uuid not null,
  occurrence_date date not null,
  reason text not null default '',
  unique (id, user_id),
  unique (user_id, course_schedule_id, occurrence_date),
  foreign key (course_schedule_id, user_id) references public.course_schedules(id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 50),
  color text not null,
  icon text not null,
  unique (id, user_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  event_type text not null default 'event' check (event_type in ('event', 'habit')),
  title text not null check (char_length(title) between 1 and 200),
  start_date date not null,
  start_time time,
  end_date date not null,
  end_time time,
  all_day boolean not null default false,
  category_id uuid,
  color text not null default '#e36b32',
  location text not null default '',
  note text not null default '',
  recurrence_type text not null default 'none' check (recurrence_type in ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'interval')),
  recurrence_until date,
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 366),
  reminder_enabled boolean not null default false,
  reminder_minutes_before integer not null default 10 check (reminder_minutes_before between 0 and 10080),
  timezone text not null default 'Asia/Shanghai',
  completed_at timestamptz,
  unique (id, user_id)
);

create table if not exists public.event_occurrence_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  event_id uuid not null,
  occurrence_date date not null,
  completed boolean not null default false,
  reminder_sent_at timestamptz,
  unique (id, user_id),
  unique (user_id, event_id, occurrence_date),
  foreign key (event_id, user_id) references public.events(id, user_id)
);

create table if not exists public.anniversaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  kind text not null default 'anniversary' check (kind in ('anniversary', 'birthday', 'holiday')),
  title text not null check (char_length(title) between 1 and 200),
  date date not null,
  color text not null default '#d97706',
  note text not null default '',
  reminder_enabled boolean not null default false,
  reminder_days_before integer not null default 0 check (reminder_days_before between 0 and 366),
  reminder_time time not null default time '09:00',
  reminder_sent_for date,
  timezone text not null default 'Asia/Shanghai',
  unique (id, user_id)
);

create table if not exists public.memo_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  sort_order integer not null default 0,
  unique (id, user_id)
);

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  folder_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '',
  is_pinned boolean not null default false,
  images jsonb not null default '[]'::jsonb,
  unique (id, user_id),
  foreign key (folder_id, user_id) references public.memo_folders(id, user_id)
);

alter table public.memos
add column if not exists images jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memos_images_array_check'
      and conrelid = 'public.memos'::regclass
  ) then
    alter table public.memos
    add constraint memos_images_array_check check (jsonb_typeof(images) = 'array');
  end if;
end
$$;

create table if not exists public.focus_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  pomodoro_minutes integer not null default 25 check (pomodoro_minutes between 1 and 240),
  short_break_minutes integer not null default 5 check (short_break_minutes between 1 and 120),
  countdown_minutes integer not null default 30 check (countdown_minutes between 1 and 720),
  daily_goal_minutes integer not null default 120 check (daily_goal_minutes between 1 and 1440),
  sound_enabled boolean not null default true,
  unique (id, user_id)
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  mode text not null check (mode in ('stopwatch', 'countdown', 'pomodoro', 'lock')),
  task_title text not null default '',
  linked_event_id uuid,
  planned_seconds integer check (planned_seconds is null or planned_seconds >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  completed boolean not null default false,
  interrupted boolean not null default false,
  unique (id, user_id),
  foreign key (linked_event_id, user_id) references public.events(id, user_id)
);

create table if not exists public.rest_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  planned_seconds integer not null check (planned_seconds >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  completed boolean not null default false,
  interrupted boolean not null default false,
  unique (id, user_id)
);

create table if not exists public.focus_audio_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('white_noise', 'music')),
  storage_path text not null unique,
  mime_type text not null default 'audio/mpeg',
  file_size bigint not null default 0 check (file_size >= 0),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_assistant_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  role text not null default 'member' check (role in ('member', 'admin')),
  expires_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_assistant_settings (
  id boolean primary key default true check (id),
  enabled_for_all boolean not null default false,
  daily_limit integer not null default 20 check (daily_limit between 0 and 100000),
  weekly_limit integer not null default 100 check (weekly_limit between daily_limit and 1000000),
  ordinary_daily_limit integer not null default 20 check (ordinary_daily_limit between 0 and 100000),
  ordinary_weekly_limit integer not null default 100 check (ordinary_weekly_limit between ordinary_daily_limit and 1000000),
  member_daily_limit integer not null default 50 check (member_daily_limit between 0 and 100000),
  member_weekly_limit integer not null default 300 check (member_weekly_limit between member_daily_limit and 1000000),
  provider text not null default 'deepseek' check (provider in ('deepseek', 'mimo')),
  model text not null default 'deepseek-v4-flash',
  mimo_channel text not null default 'payg' check (mimo_channel in ('payg', 'token_plan')),
  feature_quotas jsonb not null default '{}'::jsonb,
  constraint ai_assistant_settings_model_catalog_check check (
    (provider = 'deepseek' and model in ('deepseek-v4-flash', 'deepseek-v4-pro'))
    or
    (provider = 'mimo' and model in ('mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-pro-ultraspeed'))
  ),
  updated_at timestamptz not null default now()
);

insert into public.ai_assistant_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.ai_assistant_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'success' check (status in ('success', 'error')),
  access_method text not null default '',
  feature_key text not null default 'assistant',
  model text not null default '',
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  estimated_cost_usd numeric(14, 8),
  estimated_cost_cny numeric(14, 8),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  question_chars integer check (question_chars is null or question_chars >= 0),
  error text
);

create index if not exists ai_assistant_usage_user_requested_idx
on public.ai_assistant_usage (user_id, requested_at desc);

create index if not exists ai_assistant_usage_user_feature_requested_idx
on public.ai_assistant_usage (user_id, feature_key, requested_at desc);

create or replace function public.apply_schedule_sync_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return old;
    end if;
    new.created_at := old.created_at;
    new.version := greatest(coalesce(new.version, 1), old.version + 1);
  else
    new.version := greatest(coalesce(new.version, 1), 1);
  end if;
  new.server_updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
  tables text[] := array[
    'semesters',
    'class_periods',
    'courses',
    'course_schedules',
    'course_cancellations',
    'categories',
    'events',
    'event_occurrence_states',
    'anniversaries',
    'memo_folders',
    'memos',
    'focus_settings',
    'focus_sessions',
    'rest_sessions'
  ];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "Users manage own rows" on public.%I', table_name);
    execute format(
      'create policy "Users manage own rows" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format('drop trigger if exists set_sync_metadata on public.%I', table_name);
    execute format(
      'create trigger set_sync_metadata before insert or update on public.%I for each row execute function public.apply_schedule_sync_metadata()',
      table_name
    );
    execute format('create index if not exists %I on public.%I (user_id, server_updated_at)', table_name || '_user_sync_idx', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end
$$;

alter table public.ai_assistant_access enable row level security;
alter table public.ai_assistant_usage enable row level security;
alter table public.ai_assistant_settings enable row level security;

create or replace function public.is_ai_assistant_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ai_assistant_access admin_access
    where admin_access.user_id = auth.uid()
      and admin_access.enabled
      and admin_access.role = 'admin'
      and (admin_access.expires_at is null or admin_access.expires_at > now())
  );
$$;

revoke all on function public.is_ai_assistant_admin() from public;
grant execute on function public.is_ai_assistant_admin() to authenticated;

drop policy if exists "Users read own AI access" on public.ai_assistant_access;
create policy "Users read own AI access"
on public.ai_assistant_access
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "AI admins read all access" on public.ai_assistant_access;
create policy "AI admins read all access"
on public.ai_assistant_access
for select
to authenticated
using (public.is_ai_assistant_admin());

drop policy if exists "AI admins manage access" on public.ai_assistant_access;
create policy "AI admins manage access"
on public.ai_assistant_access
for all
to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

revoke all on public.ai_assistant_access from anon;
grant select, insert, update, delete on public.ai_assistant_access to authenticated;
grant select, insert, update, delete on public.ai_assistant_access to service_role;

revoke all on public.ai_assistant_settings from anon, authenticated;
grant select, insert, update on public.ai_assistant_settings to service_role;

drop policy if exists "Users read own AI usage" on public.ai_assistant_usage;
create policy "Users read own AI usage"
on public.ai_assistant_usage
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "AI admins read all usage" on public.ai_assistant_usage;
create policy "AI admins read all usage"
on public.ai_assistant_usage
for select
to authenticated
using (public.is_ai_assistant_admin());

revoke all on public.ai_assistant_usage from anon;
grant select on public.ai_assistant_usage to authenticated;
grant select, insert on public.ai_assistant_usage to service_role;

grant usage on schema public to authenticated;
grant usage on schema public to service_role;

create or replace function public.admin_cleanup_transient_data(
  p_retention_days integer default 90,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retention_days integer := greatest(30, least(coalesce(p_retention_days, 90), 3650));
  cutoff_time timestamptz;
  ai_usage_deleted integer := 0;
  reminder_deliveries_deleted integer := 0;
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  if p_target_user_id is not null and not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception '没有找到该用户。' using errcode = 'P0002';
  end if;

  cutoff_time := now() - make_interval(days => retention_days);

  delete from public.ai_assistant_usage
  where requested_at < cutoff_time
    and (p_target_user_id is null or user_id = p_target_user_id);
  get diagnostics ai_usage_deleted = row_count;

  delete from public.reminder_deliveries
  where claimed_at < cutoff_time
    and (p_target_user_id is null or user_id = p_target_user_id);
  get diagnostics reminder_deliveries_deleted = row_count;

  return jsonb_build_object(
    'retentionDays', retention_days,
    'cutoff', cutoff_time,
    'targetUserId', p_target_user_id,
    'aiUsageDeleted', ai_usage_deleted,
    'reminderDeliveriesDeleted', reminder_deliveries_deleted
  );
end;
$$;

revoke all on function public.admin_cleanup_transient_data(integer, uuid) from public;
grant execute on function public.admin_cleanup_transient_data(integer, uuid) to authenticated;

alter table public.focus_audio_tracks enable row level security;

drop policy if exists "Authenticated users read focus audio" on public.focus_audio_tracks;
drop policy if exists "Anyone reads focus audio" on public.focus_audio_tracks;
create policy "Anyone reads focus audio"
on public.focus_audio_tracks for select to anon, authenticated
using (true);

drop policy if exists "Admins manage focus audio" on public.focus_audio_tracks;
create policy "Admins manage focus audio"
on public.focus_audio_tracks for all to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

grant select on public.focus_audio_tracks to anon, authenticated;
grant insert, update, delete on public.focus_audio_tracks to authenticated;
grant all on public.focus_audio_tracks to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('focus-audio', 'focus-audio', true, 52428800, array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins upload focus audio objects" on storage.objects;
create policy "Admins upload focus audio objects"
on storage.objects for insert to authenticated
with check (bucket_id = 'focus-audio' and public.is_ai_assistant_admin());

drop policy if exists "Admins update focus audio objects" on storage.objects;
create policy "Admins update focus audio objects"
on storage.objects for update to authenticated
using (bucket_id = 'focus-audio' and public.is_ai_assistant_admin())
with check (bucket_id = 'focus-audio' and public.is_ai_assistant_admin());

drop policy if exists "Admins delete focus audio objects" on storage.objects;
create policy "Admins delete focus audio objects"
on storage.objects for delete to authenticated
using (bucket_id = 'focus-audio' and public.is_ai_assistant_admin());
create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null default '',
  content text not null check (char_length(content) between 2 and 4000),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  admin_reply text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_feedback_user_created_idx
on public.user_feedback (user_id, created_at desc);

create index if not exists user_feedback_status_created_idx
on public.user_feedback (status, created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists "Users create own feedback" on public.user_feedback;
create policy "Users create own feedback"
on public.user_feedback for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own feedback" on public.user_feedback;
create policy "Users read own feedback"
on public.user_feedback for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "AI admins read all feedback" on public.user_feedback;
create policy "AI admins read all feedback"
on public.user_feedback for select to authenticated
using (public.is_ai_assistant_admin());

drop policy if exists "AI admins update feedback" on public.user_feedback;
create policy "AI admins update feedback"
on public.user_feedback for update to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

grant select, insert, update on public.user_feedback to authenticated;
grant select, insert, update, delete on public.user_feedback to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own feedback attachments" on storage.objects;
create policy "Users upload own feedback attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own feedback attachments" on storage.objects;
create policy "Users read own feedback attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own feedback attachments" on storage.objects;
create policy "Users delete own feedback attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "AI admins read feedback attachments" on storage.objects;
create policy "AI admins read feedback attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-attachments'
  and public.is_ai_assistant_admin()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memo-images',
  'memo-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own memo images" on storage.objects;
create policy "Users upload own memo images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'memo-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own memo images" on storage.objects;
create policy "Users read own memo images"
on storage.objects for select to authenticated
using (
  bucket_id = 'memo-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own memo images" on storage.objects;
create policy "Users delete own memo images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'memo-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create table if not exists public.feedback_channel_settings (
  id text primary key default 'default' check (id = 'default'),
  recommended_channel text not null default '' check (char_length(recommended_channel) <= 300),
  updated_at timestamptz not null default now()
);

insert into public.feedback_channel_settings (id, recommended_channel)
values ('default', '')
on conflict (id) do nothing;

alter table public.feedback_channel_settings enable row level security;

drop policy if exists "Everyone reads feedback channel" on public.feedback_channel_settings;
create policy "Everyone reads feedback channel"
on public.feedback_channel_settings for select to anon, authenticated
using (true);

drop policy if exists "AI admins update feedback channel" on public.feedback_channel_settings;
create policy "AI admins update feedback channel"
on public.feedback_channel_settings for update to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

grant select on public.feedback_channel_settings to anon, authenticated;
grant update on public.feedback_channel_settings to authenticated;
grant select, insert, update, delete on public.feedback_channel_settings to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-avatars',
  'account-avatars',
  true,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own account avatar" on storage.objects;
create policy "Users upload own account avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own account avatar metadata" on storage.objects;
create policy "Users read own account avatar metadata"
on storage.objects for select to authenticated
using (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own account avatar" on storage.objects;
create policy "Users update own account avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own account avatar" on storage.objects;
create policy "Users delete own account avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
