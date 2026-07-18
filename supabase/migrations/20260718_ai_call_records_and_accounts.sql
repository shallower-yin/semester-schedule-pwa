alter table public.ai_assistant_usage
  drop constraint if exists ai_assistant_usage_status_check;

alter table public.ai_assistant_usage
  add constraint ai_assistant_usage_status_check
  check (status in ('running', 'success', 'error'));

alter table public.ai_assistant_usage
  drop constraint if exists ai_assistant_usage_diagnostic_id_key;

alter table public.ai_assistant_usage
  add constraint ai_assistant_usage_diagnostic_id_key unique (diagnostic_id);

grant update on public.ai_assistant_usage to service_role;

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
    raise exception '当前账号没有管理权限';
  end if;

  return query
  select users.id,
    coalesce(nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''), ''),
    users.banned_until
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
    raise exception '当前账号没有管理权限';
  end if;

  return query
  select usage.requested_at,
    usage.user_id,
    coalesce(nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''), ''),
    coalesce(users.email, ''),
    usage.feature_key,
    usage.status,
    usage.model,
    usage.diagnostic_id,
    usage.latency_ms,
    usage.error,
    coalesce(usage.diagnostic_details, '{}'::jsonb)
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
