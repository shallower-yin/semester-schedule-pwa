create or replace function public.admin_list_account_profiles()
returns table (
  user_id uuid,
  username text,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  return query
  select users.id::uuid,
    coalesce(nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''), '')::text,
    users.banned_until::timestamptz
  from auth.users users
  order by users.created_at desc;
end;
$$;

create or replace function public.admin_list_ai_call_logs(p_limit integer default 50)
returns table (
  requested_at timestamptz,
  user_id uuid,
  username text,
  email text,
  feature_key text,
  status text,
  model text,
  diagnostic_id uuid,
  latency_ms integer,
  error text,
  diagnostic_details jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  return query
  select usage.requested_at::timestamptz,
    usage.user_id::uuid,
    coalesce(nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''), '')::text,
    coalesce(users.email::text, '')::text,
    usage.feature_key::text,
    usage.status::text,
    usage.model::text,
    usage.diagnostic_id::uuid,
    usage.latency_ms::integer,
    usage.error::text,
    coalesce(usage.diagnostic_details, '{}'::jsonb)::jsonb
  from public.ai_assistant_usage usage
  join auth.users users on users.id = usage.user_id
  where usage.feature_key in ('mind_map', 'audio_transcription')
  order by usage.requested_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.admin_list_account_profiles() from public;
revoke all on function public.admin_list_ai_call_logs(integer) from public;
grant execute on function public.admin_list_account_profiles() to authenticated;
grant execute on function public.admin_list_ai_call_logs(integer) to authenticated;
