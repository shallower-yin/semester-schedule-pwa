update public.ai_assistant_settings
set feature_quotas = jsonb_set(
  coalesce(feature_quotas, '{}'::jsonb),
  '{translation}',
  coalesce(
    feature_quotas -> 'translation',
    jsonb_build_object(
      'enabled_for_all', true,
      'ordinary_daily_limit', 50,
      'ordinary_weekly_limit', 300,
      'member_daily_limit', 150,
      'member_weekly_limit', 900
    )
  ),
  true
)
where feature_quotas -> 'translation' is null;

create or replace function public.ensure_translation_feature_quota()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_translation jsonb := null;
begin
  if tg_op = 'UPDATE' then
    previous_translation := old.feature_quotas -> 'translation';
  end if;
  new.feature_quotas := jsonb_set(
    coalesce(new.feature_quotas, '{}'::jsonb),
    '{translation}',
    coalesce(
      new.feature_quotas -> 'translation',
      previous_translation,
      jsonb_build_object(
        'enabled_for_all', true,
        'ordinary_daily_limit', 50,
        'ordinary_weekly_limit', 300,
        'member_daily_limit', 150,
        'member_weekly_limit', 900
      )
    ),
    true
  );
  return new;
end;
$$;

drop trigger if exists ensure_translation_feature_quota on public.ai_assistant_settings;
create trigger ensure_translation_feature_quota
before insert or update of feature_quotas on public.ai_assistant_settings
for each row execute function public.ensure_translation_feature_quota();

alter table public.ai_assistant_settings
  drop constraint if exists ai_assistant_settings_translation_quota_check;

alter table public.ai_assistant_settings
  add constraint ai_assistant_settings_translation_quota_check check (
    feature_quotas ? 'translation'
    and jsonb_typeof(feature_quotas -> 'translation') = 'object'
    and jsonb_typeof(feature_quotas #> '{translation,enabled_for_all}') = 'boolean'
    and jsonb_typeof(feature_quotas #> '{translation,ordinary_daily_limit}') = 'number'
    and jsonb_typeof(feature_quotas #> '{translation,ordinary_weekly_limit}') = 'number'
    and jsonb_typeof(feature_quotas #> '{translation,member_daily_limit}') = 'number'
    and jsonb_typeof(feature_quotas #> '{translation,member_weekly_limit}') = 'number'
    and (feature_quotas #>> '{translation,ordinary_daily_limit}')::integer between 0 and 100000
    and (feature_quotas #>> '{translation,ordinary_weekly_limit}')::integer between (feature_quotas #>> '{translation,ordinary_daily_limit}')::integer and 1000000
    and (feature_quotas #>> '{translation,member_daily_limit}')::integer between 0 and 100000
    and (feature_quotas #>> '{translation,member_weekly_limit}')::integer between (feature_quotas #>> '{translation,member_daily_limit}')::integer and 1000000
  );

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
  where usage.feature_key in ('translation', 'mind_map', 'audio_transcription')
  order by usage.requested_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.admin_list_ai_call_logs(integer) from public;
grant execute on function public.admin_list_ai_call_logs(integer) to authenticated;
