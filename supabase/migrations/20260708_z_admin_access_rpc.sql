create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  confirmed_at timestamptz,
  semesters bigint,
  courses bigint,
  events bigint,
  habits bigint,
  anniversaries bigint,
  memos bigint,
  focus_sessions bigint,
  ai_user_id uuid,
  ai_enabled boolean,
  ai_role text,
  ai_expires_at timestamptz,
  ai_note text,
  ai_created_at timestamptz,
  ai_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  return query
  select
    auth_user.id,
    coalesce(auth_user.email, ''),
    auth_user.created_at,
    auth_user.last_sign_in_at,
    auth_user.confirmed_at,
    (select count(*) from public.semesters item where item.user_id = auth_user.id and item.deleted_at is null),
    (select count(*) from public.courses item where item.user_id = auth_user.id and item.deleted_at is null),
    (select count(*) from public.events item where item.user_id = auth_user.id and item.deleted_at is null and item.event_type <> 'habit'),
    (select count(*) from public.events item where item.user_id = auth_user.id and item.deleted_at is null and item.event_type = 'habit'),
    (select count(*) from public.anniversaries item where item.user_id = auth_user.id and item.deleted_at is null),
    (select count(*) from public.memos item where item.user_id = auth_user.id and item.deleted_at is null),
    (select count(*) from public.focus_sessions item where item.user_id = auth_user.id and item.deleted_at is null),
    access.user_id,
    access.enabled,
    access.role,
    access.expires_at,
    access.note,
    access.created_at,
    access.updated_at
  from auth.users auth_user
  left join public.ai_assistant_access access on access.user_id = auth_user.id
  order by auth_user.created_at desc;
end;
$$;

create or replace function public.admin_set_ai_access(
  p_target_user_id uuid default null,
  p_target_email text default null,
  p_enabled boolean default true,
  p_role text default 'member',
  p_expires_at timestamptz default null,
  p_note text default null
)
returns table (
  user_id uuid,
  enabled boolean,
  role text,
  expires_at timestamptz,
  note text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id uuid;
  normalized_email text;
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception '权限角色无效。' using errcode = '22023';
  end if;

  resolved_user_id := p_target_user_id;
  normalized_email := lower(nullif(trim(coalesce(p_target_email, '')), ''));
  if resolved_user_id is null and normalized_email is not null then
    select auth_user.id
    into resolved_user_id
    from auth.users auth_user
    where lower(auth_user.email) = normalized_email
    order by auth_user.created_at desc
    limit 1;
  end if;
  if resolved_user_id is null then
    raise exception '没有找到该邮箱对应的账号。' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = resolved_user_id) then
    raise exception '没有找到该用户。' using errcode = 'P0002';
  end if;

  return query
  insert into public.ai_assistant_access (user_id, enabled, role, expires_at, note, updated_at)
  values (
    resolved_user_id,
    coalesce(p_enabled, false),
    p_role,
    p_expires_at,
    coalesce(p_note, ''),
    now()
  )
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    role = excluded.role,
    expires_at = excluded.expires_at,
    note = excluded.note,
    updated_at = now()
  returning
    ai_assistant_access.user_id,
    ai_assistant_access.enabled,
    ai_assistant_access.role,
    ai_assistant_access.expires_at,
    ai_assistant_access.note,
    ai_assistant_access.created_at,
    ai_assistant_access.updated_at;
end;
$$;

create or replace function public.admin_get_user_details(p_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'passwordVisible', false,
    'user', coalesce((
      select jsonb_build_object(
        'id', auth_user.id,
        'email', coalesce(auth_user.email, ''),
        'createdAt', auth_user.created_at,
        'lastSignInAt', auth_user.last_sign_in_at,
        'confirmedAt', auth_user.confirmed_at
      )
      from auth.users auth_user
      where auth_user.id = p_target_user_id
      limit 1
    ), jsonb_build_object(
      'id', p_target_user_id,
      'email', '',
      'createdAt', null,
      'lastSignInAt', null,
      'confirmedAt', null
    )),
    'aiAccess', (
      select to_jsonb(access)
      from public.ai_assistant_access access
      where access.user_id = p_target_user_id
      limit 1
    ),
    'data', jsonb_build_object(
      'semesters', coalesce((select jsonb_agg(to_jsonb(item)) from (select id, name, start_date, total_weeks, is_current, updated_at from public.semesters where user_id = p_target_user_id and deleted_at is null order by updated_at desc limit 20) item), '[]'::jsonb),
      'courses', coalesce((select jsonb_agg(to_jsonb(item)) from (select id, semester_id, name, teacher, classroom, color, note, updated_at from public.courses where user_id = p_target_user_id and deleted_at is null order by updated_at desc limit 20) item), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(to_jsonb(item)) from (select id, event_type, title, start_date, start_time, end_date, end_time, all_day, color, note, recurrence_type, reminder_enabled, updated_at from public.events where user_id = p_target_user_id and deleted_at is null order by updated_at desc limit 20) item), '[]'::jsonb),
      'anniversaries', coalesce((select jsonb_agg(to_jsonb(item)) from (select id, kind, title, date, color, note, reminder_enabled, reminder_days_before, reminder_time, updated_at from public.anniversaries where user_id = p_target_user_id and deleted_at is null order by updated_at desc limit 20) item), '[]'::jsonb),
      'memos', coalesce((select jsonb_agg(to_jsonb(item)) from (select id, title, content, is_pinned, updated_at from public.memos where user_id = p_target_user_id and deleted_at is null order by updated_at desc limit 20) item), '[]'::jsonb),
      'focusSessions', coalesce((select jsonb_agg(to_jsonb(item)) from (select id, mode, task_title, duration_seconds, started_at, ended_at, completed, interrupted from public.focus_sessions where user_id = p_target_user_id and deleted_at is null order by started_at desc limit 20) item), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_ai_access(uuid, text, boolean, text, timestamptz, text) from public;
revoke all on function public.admin_get_user_details(uuid) from public;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_ai_access(uuid, text, boolean, text, timestamptz, text) to authenticated;
grant execute on function public.admin_get_user_details(uuid) to authenticated;
