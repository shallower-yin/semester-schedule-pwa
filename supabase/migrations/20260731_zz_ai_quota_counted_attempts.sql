alter table public.ai_assistant_usage
  add column if not exists quota_counted boolean not null default false;

-- Existing successful calls were user-visible completed attempts and should
-- continue to count in historical quota windows after this migration.
update public.ai_assistant_usage
set quota_counted = true
where status = 'success' and quota_counted = false;

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
  beijing_now timestamp := timezone('Asia/Shanghai', now());
  day_start timestamptz;
  week_start timestamptz;
  recent_count integer := 0;
  today_count integer := 0;
  week_count integer := 0;
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
    and usage.quota_counted;
  if recent_count >= 30 then
    return jsonb_build_object('allowed', false, 'rateLimited', true);
  end if;

  select count(*)::integer into today_count
  from public.ai_assistant_usage usage
  where usage.user_id = p_user_id
    and usage.feature_key = p_feature_key
    and usage.requested_at >= day_start
    and usage.quota_counted;

  select count(*)::integer into week_count
  from public.ai_assistant_usage usage
  where usage.user_id = p_user_id
    and usage.feature_key = p_feature_key
    and usage.requested_at >= week_start
    and usage.quota_counted;

  if p_daily_limit is not null and today_count >= p_daily_limit then
    return jsonb_build_object('allowed', false, 'todayRequests', today_count, 'weekRequests', week_count);
  end if;
  if p_weekly_limit is not null and week_count >= p_weekly_limit then
    return jsonb_build_object('allowed', false, 'todayRequests', today_count, 'weekRequests', week_count);
  end if;

  insert into public.ai_assistant_usage (
    user_id, requested_at, status, quota_counted, access_method, feature_key, model,
    prompt_tokens, completion_tokens, total_tokens, latency_ms,
    question_chars, diagnostic_id, diagnostic_details
  ) values (
    p_user_id, now(), 'running', true, coalesce(p_access_method, ''),
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

create or replace function public.check_ai_global_budget(
  p_daily_cost_cny_limit numeric,
  p_daily_token_limit bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  beijing_now timestamp := timezone('Asia/Shanghai', now());
  day_start timestamptz;
  used_cost numeric := 0;
  used_tokens bigint := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  day_start := date_trunc('day', beijing_now) at time zone 'Asia/Shanghai';

  select
    coalesce(sum(usage.estimated_cost_cny), 0),
    coalesce(sum(usage.total_tokens), 0)
  into used_cost, used_tokens
  from public.ai_assistant_usage usage
  where usage.requested_at >= day_start
    and usage.quota_counted;

  return jsonb_build_object(
    'allowed',
      used_cost < greatest(coalesce(p_daily_cost_cny_limit, 0), 0)
      and used_tokens < greatest(coalesce(p_daily_token_limit, 0), 0),
    'usedCostCny', used_cost,
    'usedTokens', used_tokens
  );
end;
$$;

revoke all on function public.check_ai_global_budget(numeric, bigint) from public;
grant execute on function public.check_ai_global_budget(numeric, bigint) to service_role;
