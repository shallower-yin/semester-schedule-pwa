-- Atomic AI quota reservations, replay-safe paid audio tasks, and the fixed
-- Asia/Shanghai product-time contract. All changes are additive/idempotent.

alter table public.ai_assistant_usage
  drop constraint if exists ai_assistant_usage_status_check;
alter table public.ai_assistant_usage
  add constraint ai_assistant_usage_status_check
  check (status in ('running', 'success', 'error'));

-- Older deployments attempted an upsert against a non-unique diagnostic index,
-- so collapse any duplicate diagnostics before making reservations upsertable.
delete from public.ai_assistant_usage older
using public.ai_assistant_usage newer
where older.diagnostic_id is not null
  and older.diagnostic_id = newer.diagnostic_id
  and (
    older.requested_at < newer.requested_at
    or (older.requested_at = newer.requested_at and older.id::text < newer.id::text)
  );

drop index if exists public.ai_assistant_usage_diagnostic_idx;
create unique index if not exists ai_assistant_usage_diagnostic_uidx
on public.ai_assistant_usage (diagnostic_id)
where diagnostic_id is not null;

create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_feature_key text,
  p_access_method text,
  p_model text,
  p_daily_limit integer,
  p_weekly_limit integer,
  p_diagnostic_id uuid,
  p_stage text default 'request'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  beijing_now timestamp := now() at time zone 'Asia/Shanghai';
  day_start timestamptz;
  week_start timestamptz;
  today_count integer;
  week_count integer;
  recent_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_diagnostic_id is null then
    raise exception 'invalid AI reservation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || coalesce(p_feature_key, ''), 0));
  day_start := date_trunc('day', beijing_now) at time zone 'Asia/Shanghai';
  week_start := date_trunc('week', beijing_now) at time zone 'Asia/Shanghai';

  select count(*)::integer into recent_count
  from public.ai_assistant_usage usage
  where usage.user_id = p_user_id
    and usage.requested_at >= now() - interval '1 minute'
    and (
      usage.status = 'success'
      or (usage.status = 'running' and usage.requested_at >= now() - interval '30 minutes')
    );
  if recent_count >= 30 then
    return jsonb_build_object('allowed', false, 'rateLimited', true);
  end if;

  select count(*)::integer into today_count
  from public.ai_assistant_usage usage
  where usage.user_id = p_user_id
    and usage.feature_key = p_feature_key
    and usage.requested_at >= day_start
    and (
      usage.status = 'success'
      or (usage.status = 'running' and usage.requested_at >= now() - interval '30 minutes')
    );

  select count(*)::integer into week_count
  from public.ai_assistant_usage usage
  where usage.user_id = p_user_id
    and usage.feature_key = p_feature_key
    and usage.requested_at >= week_start
    and (
      usage.status = 'success'
      or (usage.status = 'running' and usage.requested_at >= now() - interval '30 minutes')
    );

  if p_daily_limit is not null and today_count >= p_daily_limit then
    return jsonb_build_object('allowed', false, 'todayRequests', today_count, 'weekRequests', week_count);
  end if;
  if p_weekly_limit is not null and week_count >= p_weekly_limit then
    return jsonb_build_object('allowed', false, 'todayRequests', today_count, 'weekRequests', week_count);
  end if;

  insert into public.ai_assistant_usage (
    user_id, requested_at, status, access_method, feature_key, model,
    prompt_tokens, completion_tokens, total_tokens, latency_ms,
    question_chars, diagnostic_id, diagnostic_details
  ) values (
    p_user_id, now(), 'running', coalesce(p_access_method, ''),
    coalesce(p_feature_key, 'assistant'), coalesce(p_model, ''),
    0, 0, 0, 0, 0, p_diagnostic_id,
    jsonb_build_object('stage', coalesce(p_stage, 'request'))
  )
  on conflict (diagnostic_id) where diagnostic_id is not null do nothing;

  return jsonb_build_object(
    'allowed', true,
    'todayRequests', today_count,
    'weekRequests', week_count
  );
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, text, text, text, integer, integer, uuid, text) from public;
grant execute on function public.reserve_ai_usage(uuid, text, text, text, integer, integer, uuid, text) to service_role;

create table if not exists public.ai_paid_task_executions (
  nonce uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'success')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb
);

alter table public.ai_paid_task_executions enable row level security;
revoke all on public.ai_paid_task_executions from anon, authenticated;
grant select, insert, update, delete on public.ai_paid_task_executions to service_role;

create or replace function public.begin_ai_paid_task(
  p_user_id uuid,
  p_nonce uuid,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.ai_paid_task_executions%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '20 minutes' then
    return jsonb_build_object('state', 'expired');
  end if;

  delete from public.ai_paid_task_executions where expires_at < now() - interval '1 day';
  insert into public.ai_paid_task_executions (nonce, user_id, expires_at)
  values (p_nonce, p_user_id, p_expires_at)
  on conflict (nonce) do nothing;
  if found then
    return jsonb_build_object('state', 'new');
  end if;

  select * into existing
  from public.ai_paid_task_executions
  where nonce = p_nonce and user_id = p_user_id;
  if existing.status = 'success' then
    return jsonb_build_object('state', 'success', 'result', existing.result);
  end if;
  if existing.started_at < now() - interval '2 minutes' then
    update public.ai_paid_task_executions set started_at = now() where nonce = p_nonce;
    return jsonb_build_object('state', 'new');
  end if;
  return jsonb_build_object('state', 'running');
end;
$$;

create or replace function public.complete_ai_paid_task(
  p_user_id uuid,
  p_nonce uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.ai_paid_task_executions
  set status = 'success', completed_at = now(), result = p_result
  where nonce = p_nonce and user_id = p_user_id;
end;
$$;

create or replace function public.fail_ai_paid_task(p_user_id uuid, p_nonce uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.ai_paid_task_executions
  where nonce = p_nonce and user_id = p_user_id and status = 'running';
end;
$$;

revoke all on function public.begin_ai_paid_task(uuid, uuid, timestamptz) from public;
revoke all on function public.complete_ai_paid_task(uuid, uuid, jsonb) from public;
revoke all on function public.fail_ai_paid_task(uuid, uuid) from public;
grant execute on function public.begin_ai_paid_task(uuid, uuid, timestamptz) to service_role;
grant execute on function public.complete_ai_paid_task(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_ai_paid_task(uuid, uuid) to service_role;

update public.events set timezone = 'Asia/Shanghai' where timezone is distinct from 'Asia/Shanghai';
update public.anniversaries set timezone = 'Asia/Shanghai' where timezone is distinct from 'Asia/Shanghai';
alter table public.events alter column timezone set default 'Asia/Shanghai';
alter table public.anniversaries alter column timezone set default 'Asia/Shanghai';
