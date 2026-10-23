-- One quota reservation per complete audio submission; actual provider usage
-- remains per-stage. No legacy RPC signature is changed.
create table if not exists public.ai_audio_submissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  closed_at timestamptz,
  primary key (user_id, submission_id)
);
create index if not exists ai_audio_submissions_expiry_idx on public.ai_audio_submissions(expires_at);

create table if not exists public.ai_audio_submission_tasks (
  user_id uuid not null,
  submission_id uuid not null,
  task_key text not null,
  request_hash text not null,
  diagnostic_id uuid not null,
  status text not null check (status in ('running', 'success', 'error')),
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  result jsonb,
  primary key (user_id, submission_id, task_key),
  foreign key (user_id, submission_id) references public.ai_audio_submissions(user_id, submission_id) on delete cascade
);
create index if not exists ai_audio_submission_tasks_started_idx on public.ai_audio_submission_tasks(user_id, started_at);
alter table public.ai_audio_submissions enable row level security;
alter table public.ai_audio_submission_tasks enable row level security;
revoke all on public.ai_audio_submissions, public.ai_audio_submission_tasks from public, anon, authenticated;
grant select, insert, update, delete on public.ai_audio_submissions, public.ai_audio_submission_tasks to service_role;

create or replace function public.begin_ai_audio_submission_task(
  p_user_id uuid, p_submission_id uuid, p_manifest jsonb,
  p_task_key text, p_request_hash text, p_diagnostic_id uuid,
  p_access_method text, p_model text, p_daily_limit integer, p_weekly_limit integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  submission public.ai_audio_submissions%rowtype;
  task public.ai_audio_submission_tasks%rowtype;
  reservation jsonb;
  today_count integer;
  week_count integer;
  day_start timestamptz := date_trunc('day', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  week_start timestamptz := date_trunc('week', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_user_id is null or p_submission_id is null or p_diagnostic_id is null
    or p_manifest is null or jsonb_typeof(p_manifest->'audios') is distinct from 'array'
    or jsonb_array_length(p_manifest->'audios') not between 1 and 80
    or length(p_manifest::text) > 100000 or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_task_key is null or length(p_task_key) > 250
    or (p_task_key not like 'file:%' and p_task_key not like 'range:%' and p_task_key not in ('finalize', 'summary')) then
    raise exception 'invalid audio submission';
  end if;
  -- Same lock as reserve_ai_usage: new submissions cannot race the quota ceiling.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':audio_transcription', 0));
  delete from public.ai_audio_submissions where expires_at < now() - interval '1 day';
  select * into submission from public.ai_audio_submissions
    where user_id = p_user_id and submission_id = p_submission_id;
  if found then
    if submission.manifest <> p_manifest then return jsonb_build_object('state', 'mismatch'); end if;
    if submission.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  else
    -- A summary is not a free-standing submission. Follow-up Q&A keeps its own quota path.
    if p_task_key in ('finalize', 'summary') then return jsonb_build_object('state', 'missing'); end if;
  end if;
  select * into task from public.ai_audio_submission_tasks
    where user_id = p_user_id and submission_id = p_submission_id and task_key = p_task_key;
  if found then
    if task.request_hash <> p_request_hash then return jsonb_build_object('state', 'mismatch'); end if;
    if task.status = 'success' then return jsonb_build_object('state', 'success', 'result', task.result); end if;
    -- A timed-out worker is not silently stolen: that could overlap real paid calls.
    if task.status = 'running' then return jsonb_build_object('state', 'busy'); end if;
    if task.attempts >= 6 then return jsonb_build_object('state', 'limited'); end if;
  end if;
  if submission.closed_at is not null then return jsonb_build_object('state', 'closed'); end if;
  if (select count(*) from public.ai_audio_submission_tasks running
      join public.ai_audio_submissions parent using (user_id, submission_id)
      where running.user_id = p_user_id and running.status = 'running' and parent.expires_at > now()) >= 4
    or (select count(*) from public.ai_audio_submission_tasks where user_id = p_user_id and started_at >= now() - interval '1 minute') >= 120 then
    return jsonb_build_object('state', 'limited');
  end if;
  if submission.submission_id is null then
    reservation := public.reserve_ai_usage(p_user_id, 'audio_transcription', p_access_method,
      p_model, p_daily_limit, p_weekly_limit, p_diagnostic_id, 'audio_submission');
    if not coalesce((reservation->>'allowed')::boolean, false) then
      return jsonb_build_object('state', 'denied');
    end if;
    insert into public.ai_audio_submissions(user_id, submission_id, manifest)
      values (p_user_id, p_submission_id, p_manifest);
  elsif p_task_key in ('finalize', 'summary') and not exists (
    select 1 from public.ai_audio_submission_tasks where user_id = p_user_id and submission_id = p_submission_id
      and status = 'success' and (task_key like 'file:%' or task_key like 'range:%')
  ) then
    return jsonb_build_object('state', 'missing');
  end if;
  insert into public.ai_audio_submission_tasks(user_id, submission_id, task_key, request_hash, diagnostic_id, status)
    values (p_user_id, p_submission_id, p_task_key, p_request_hash, p_diagnostic_id, 'running')
    on conflict (user_id, submission_id, task_key) do update set
      status = 'running', diagnostic_id = excluded.diagnostic_id, started_at = now(),
      attempts = ai_audio_submission_tasks.attempts + 1, result = null;
  -- Every attempt has its own diagnostics/cost row, but only the first one counts as a quota attempt.
  insert into public.ai_assistant_usage(user_id, requested_at, status, quota_counted, access_method, feature_key,
    model, prompt_tokens, completion_tokens, total_tokens, latency_ms, question_chars, diagnostic_id, diagnostic_details)
    values (p_user_id, now(), 'running', false, p_access_method, 'audio_transcription', p_model,
      0, 0, 0, 0, 0, p_diagnostic_id, jsonb_build_object('stage', p_task_key, 'submissionId', p_submission_id))
    on conflict (diagnostic_id) where diagnostic_id is not null do nothing;
  select count(*)::integer into today_count from public.ai_assistant_usage
    where user_id = p_user_id and feature_key = 'audio_transcription' and quota_counted and requested_at >= day_start;
  select count(*)::integer into week_count from public.ai_assistant_usage
    where user_id = p_user_id and feature_key = 'audio_transcription' and quota_counted and requested_at >= week_start;
  return jsonb_build_object('state', 'new', 'todayRequests', today_count, 'weekRequests', week_count);
end;
$$;

create or replace function public.finish_ai_audio_submission_task(
  p_user_id uuid, p_submission_id uuid, p_task_key text, p_diagnostic_id uuid, p_result jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  update public.ai_audio_submission_tasks set status = case when p_result is null then 'error' else 'success' end,
    result = p_result
    where user_id = p_user_id and submission_id = p_submission_id and task_key = p_task_key
      and diagnostic_id = p_diagnostic_id and status = 'running';
end;
$$;

create or replace function public.close_ai_audio_submission(p_user_id uuid, p_submission_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':audio_transcription', 0));
  -- Tombstone even when cancellation reaches the server before the first leaf.
  insert into public.ai_audio_submissions(user_id, submission_id, manifest, closed_at)
    values (p_user_id, p_submission_id, '{}'::jsonb, now())
    on conflict (user_id, submission_id) do update set closed_at = coalesce(ai_audio_submissions.closed_at, now());
end;
$$;

revoke all on function public.begin_ai_audio_submission_task(uuid, uuid, jsonb, text, text, uuid, text, text, integer, integer) from public;
revoke all on function public.finish_ai_audio_submission_task(uuid, uuid, text, uuid, jsonb) from public;
revoke all on function public.close_ai_audio_submission(uuid, uuid) from public;
grant execute on function public.begin_ai_audio_submission_task(uuid, uuid, jsonb, text, text, uuid, text, text, integer, integer) to service_role;
grant execute on function public.finish_ai_audio_submission_task(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.close_ai_audio_submission(uuid, uuid) to service_role;

-- Quota_counted describes user attempts, not provider cost. Count all trusted
-- server-recorded stages, including retries and summaries, in the global budget.
create or replace function public.check_ai_global_budget(p_daily_cost_cny_limit numeric, p_daily_token_limit bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  day_start timestamptz := date_trunc('day', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  used_cost numeric;
  used_tokens bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select coalesce(sum(estimated_cost_cny), 0), coalesce(sum(total_tokens), 0) into used_cost, used_tokens
    from public.ai_assistant_usage where requested_at >= day_start;
  return jsonb_build_object('allowed', used_cost < greatest(coalesce(p_daily_cost_cny_limit, 0), 0)
    and used_tokens < greatest(coalesce(p_daily_token_limit, 0), 0), 'usedCostCny', used_cost, 'usedTokens', used_tokens);
end;
$$;
revoke all on function public.check_ai_global_budget(numeric, bigint) from public;
grant execute on function public.check_ai_global_budget(numeric, bigint) to service_role;
