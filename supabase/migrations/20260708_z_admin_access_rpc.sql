drop function if exists public.admin_list_users();
drop function if exists public.admin_set_ai_access(uuid, text, boolean, text, timestamptz, text);
drop function if exists public.admin_get_user_details(uuid);
drop function if exists public.get_my_ai_access();

create or replace function public.get_my_ai_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  result jsonb;
begin
  if current_user_id is null then
    return null;
  end if;

  select to_jsonb(access_row)
  into result
  from (
    select
      access.user_id,
      access.enabled,
      access.role,
      access.expires_at,
      access.note,
      access.created_at,
      access.updated_at
    from public.ai_assistant_access access
    where access.user_id = current_user_id
    limit 1
  ) access_row;

  return result;
end;
$$;

create or replace function public.admin_list_users()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', auth_user.id,
      'email', coalesce(auth_user.email::text, ''),
      'created_at', auth_user.created_at,
      'last_sign_in_at', auth_user.last_sign_in_at,
      'confirmed_at', auth_user.confirmed_at,
      'semesters', (select count(*) from public.semesters item where item.user_id = auth_user.id and item.deleted_at is null),
      'courses', (select count(*) from public.courses item where item.user_id = auth_user.id and item.deleted_at is null),
      'events', (select count(*) from public.events item where item.user_id = auth_user.id and item.deleted_at is null and item.event_type <> 'habit'),
      'habits', (select count(*) from public.events item where item.user_id = auth_user.id and item.deleted_at is null and item.event_type = 'habit'),
      'anniversaries', (select count(*) from public.anniversaries item where item.user_id = auth_user.id and item.deleted_at is null),
      'memos', (select count(*) from public.memos item where item.user_id = auth_user.id and item.deleted_at is null),
      'focus_sessions', (select count(*) from public.focus_sessions item where item.user_id = auth_user.id and item.deleted_at is null),
      'ai_user_id', access.user_id,
      'ai_enabled', access.enabled,
      'ai_role', access.role,
      'ai_expires_at', access.expires_at,
      'ai_note', access.note,
      'ai_created_at', access.created_at,
      'ai_updated_at', access.updated_at
    )
    order by auth_user.created_at desc
  ), '[]'::jsonb)
  into result
  from auth.users auth_user
  left join public.ai_assistant_access access on access.user_id = auth_user.id;

  return result;
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
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id uuid;
  normalized_email text;
  result jsonb;
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
    where lower(auth_user.email::text) = normalized_email
    order by auth_user.created_at desc
    limit 1;
  end if;
  if resolved_user_id is null then
    raise exception '没有找到该邮箱对应的账号。' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = resolved_user_id) then
    raise exception '没有找到该用户。' using errcode = 'P0002';
  end if;

  with upserted as (
    insert into public.ai_assistant_access as access (
      user_id,
      enabled,
      role,
      expires_at,
      note,
      updated_at
    )
    values (
      resolved_user_id,
      coalesce(p_enabled, false),
      p_role,
      p_expires_at,
      coalesce(p_note, ''),
      now()
    )
    on conflict on constraint ai_assistant_access_pkey do update set
      enabled = excluded.enabled,
      role = excluded.role,
      expires_at = excluded.expires_at,
      note = excluded.note,
      updated_at = now()
    returning
      access.user_id,
      access.enabled,
      access.role,
      access.expires_at,
      access.note,
      access.created_at,
      access.updated_at
  )
  select to_jsonb(upserted)
  into result
  from upserted;

  return result;
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
        'email', coalesce(auth_user.email::text, ''),
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
      select to_jsonb(access_row)
      from (
        select
          access.user_id,
          access.enabled,
          access.role,
          access.expires_at,
          access.note,
          access.created_at,
          access.updated_at
        from public.ai_assistant_access access
        where access.user_id = p_target_user_id
        limit 1
      ) access_row
    ),
    'data', jsonb_build_object(
      'semesters', coalesce((select jsonb_agg(to_jsonb(item)) from (select semester.id, semester.name, semester.start_date, semester.total_weeks, semester.is_current, semester.updated_at from public.semesters semester where semester.user_id = p_target_user_id and semester.deleted_at is null order by semester.updated_at desc limit 20) item), '[]'::jsonb),
      'courses', coalesce((select jsonb_agg(to_jsonb(item)) from (select course.id, course.semester_id, course.name, course.teacher, course.classroom, course.color, course.note, course.updated_at from public.courses course where course.user_id = p_target_user_id and course.deleted_at is null order by course.updated_at desc limit 20) item), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(to_jsonb(item)) from (select event.id, event.event_type, event.title, event.start_date, event.start_time, event.end_date, event.end_time, event.all_day, event.color, event.note, event.recurrence_type, event.reminder_enabled, event.updated_at from public.events event where event.user_id = p_target_user_id and event.deleted_at is null order by event.updated_at desc limit 20) item), '[]'::jsonb),
      'anniversaries', coalesce((select jsonb_agg(to_jsonb(item)) from (select anniversary.id, anniversary.kind, anniversary.title, anniversary.date, anniversary.color, anniversary.note, anniversary.reminder_enabled, anniversary.reminder_days_before, anniversary.reminder_time, anniversary.updated_at from public.anniversaries anniversary where anniversary.user_id = p_target_user_id and anniversary.deleted_at is null order by anniversary.updated_at desc limit 20) item), '[]'::jsonb),
      'memos', coalesce((select jsonb_agg(to_jsonb(item)) from (select memo.id, memo.title, memo.content, memo.is_pinned, memo.updated_at from public.memos memo where memo.user_id = p_target_user_id and memo.deleted_at is null order by memo.updated_at desc limit 20) item), '[]'::jsonb),
      'focusSessions', coalesce((select jsonb_agg(to_jsonb(item)) from (select focus_session.id, focus_session.mode, focus_session.task_title, focus_session.duration_seconds, focus_session.started_at, focus_session.ended_at, focus_session.completed, focus_session.interrupted from public.focus_sessions focus_session where focus_session.user_id = p_target_user_id and focus_session.deleted_at is null order by focus_session.started_at desc limit 20) item), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_my_ai_access() from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_ai_access(uuid, text, boolean, text, timestamptz, text) from public;
revoke all on function public.admin_get_user_details(uuid) from public;

grant execute on function public.get_my_ai_access() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_ai_access(uuid, text, boolean, text, timestamptz, text) to authenticated;
grant execute on function public.admin_get_user_details(uuid) to authenticated;
