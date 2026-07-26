alter table public.ai_assistant_settings
  add column if not exists audio_provider text not null default 'mimo',
  add column if not exists audio_model text not null default 'mimo-v2.5-asr';

alter table public.ai_assistant_settings
  drop constraint if exists ai_assistant_settings_provider_check,
  drop constraint if exists ai_assistant_settings_model_catalog_check,
  drop constraint if exists ai_assistant_settings_audio_provider_check,
  drop constraint if exists ai_assistant_settings_audio_model_catalog_check;

update public.ai_assistant_settings
set
  provider = case when provider in ('deepseek', 'mimo', 'siliconflow', 'tju') then provider else 'deepseek' end,
  model = case
    when provider = 'deepseek' and model in ('deepseek-v4-flash', 'deepseek-v4-pro') then model
    when provider = 'mimo' and model in ('mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-pro-ultraspeed') then model
    when provider = 'siliconflow' and model in ('Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1') then model
    when provider = 'tju' and model = 'tju-llm' then model
    else 'deepseek-v4-flash'
  end,
  audio_provider = case when audio_provider in ('mimo', 'siliconflow') then audio_provider else 'mimo' end,
  audio_model = case
    when audio_provider = 'mimo' and audio_model in ('mimo-v2.5-asr') then audio_model
    when audio_provider = 'siliconflow' and audio_model in ('TeleAI/TeleSpeechASR', 'FunAudioLLM/SenseVoiceSmall') then audio_model
    else 'mimo-v2.5-asr'
  end;

alter table public.ai_assistant_settings
  add constraint ai_assistant_settings_provider_check
    check (provider in ('deepseek', 'mimo', 'siliconflow', 'tju')),
  add constraint ai_assistant_settings_model_catalog_check
    check (
      (provider = 'deepseek' and model in ('deepseek-v4-flash', 'deepseek-v4-pro'))
      or
      (provider = 'mimo' and model in ('mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-pro-ultraspeed'))
      or
      (provider = 'siliconflow' and model in ('Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'))
      or
      (provider = 'tju' and model = 'tju-llm')
    ),
  add constraint ai_assistant_settings_audio_provider_check
    check (audio_provider in ('mimo', 'siliconflow')),
  add constraint ai_assistant_settings_audio_model_catalog_check
    check (
      (audio_provider = 'mimo' and audio_model in ('mimo-v2.5-asr'))
      or
      (audio_provider = 'siliconflow' and audio_model in ('TeleAI/TeleSpeechASR', 'FunAudioLLM/SenseVoiceSmall'))
    );

create or replace function public.admin_set_ai_settings(
  p_enabled_for_all boolean,
  p_ordinary_daily_limit integer,
  p_ordinary_weekly_limit integer,
  p_member_daily_limit integer,
  p_member_weekly_limit integer,
  p_provider text,
  p_model text,
  p_mimo_channel text,
  p_audio_provider text,
  p_audio_model text,
  p_feature_quotas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_model text := trim(coalesce(p_model, ''));
  normalized_mimo_channel text := lower(trim(coalesce(p_mimo_channel, '')));
  normalized_audio_provider text := lower(trim(coalesce(p_audio_provider, '')));
  normalized_audio_model text := trim(coalesce(p_audio_model, ''));
  normalized_feature_quotas jsonb;
  feature_name text;
  feature_value jsonb;
  ordinary_daily integer;
  ordinary_weekly integer;
  member_daily integer;
  member_weekly integer;
begin
  if not public.is_ai_assistant_admin() then
    raise exception 'Current account is not an administrator.' using errcode = '42501';
  end if;
  if normalized_provider not in ('deepseek', 'mimo', 'siliconflow', 'tju') then
    raise exception 'Unsupported AI provider.' using errcode = '22023';
  end if;
  if not (
    (normalized_provider = 'deepseek' and normalized_model in ('deepseek-v4-flash', 'deepseek-v4-pro'))
    or
    (normalized_provider = 'mimo' and normalized_model in ('mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-pro-ultraspeed'))
    or
    (normalized_provider = 'siliconflow' and normalized_model in ('Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'))
    or
    (normalized_provider = 'tju' and normalized_model = 'tju-llm')
  ) then
    raise exception 'Unsupported AI model for selected provider.' using errcode = '22023';
  end if;
  if normalized_mimo_channel not in ('payg', 'token_plan') then
    raise exception 'Unsupported MiMo channel.' using errcode = '22023';
  end if;
  if normalized_audio_provider not in ('mimo', 'siliconflow') then
    raise exception 'Unsupported audio transcription provider.' using errcode = '22023';
  end if;
  if not (
    (normalized_audio_provider = 'mimo' and normalized_audio_model in ('mimo-v2.5-asr'))
    or
    (normalized_audio_provider = 'siliconflow' and normalized_audio_model in ('TeleAI/TeleSpeechASR', 'FunAudioLLM/SenseVoiceSmall'))
  ) then
    raise exception 'Unsupported audio transcription model for selected provider.' using errcode = '22023';
  end if;

  normalized_feature_quotas := coalesce(p_feature_quotas, '{}'::jsonb);
  foreach feature_name in array array['assistant', 'mind_map', 'audio_transcription'] loop
    feature_value := normalized_feature_quotas -> feature_name;
    if feature_value is null or jsonb_typeof(feature_value) <> 'object' then
      raise exception 'Incomplete AI feature quota: %.', feature_name using errcode = '22023';
    end if;
    ordinary_daily := floor(coalesce((feature_value ->> 'ordinary_daily_limit')::numeric, -1));
    ordinary_weekly := floor(coalesce((feature_value ->> 'ordinary_weekly_limit')::numeric, -1));
    member_daily := floor(coalesce((feature_value ->> 'member_daily_limit')::numeric, -1));
    member_weekly := floor(coalesce((feature_value ->> 'member_weekly_limit')::numeric, -1));
    if ordinary_daily < 0 or ordinary_daily > 100000 then
      raise exception 'Daily ordinary quota must be between 0 and 100000.' using errcode = '22023';
    end if;
    if ordinary_weekly < ordinary_daily or ordinary_weekly > 1000000 then
      raise exception 'Weekly ordinary quota is invalid.' using errcode = '22023';
    end if;
    if member_daily < 0 or member_daily > 100000 then
      raise exception 'Daily member quota must be between 0 and 100000.' using errcode = '22023';
    end if;
    if member_weekly < member_daily or member_weekly > 1000000 then
      raise exception 'Weekly member quota is invalid.' using errcode = '22023';
    end if;
    normalized_feature_quotas := jsonb_set(
      normalized_feature_quotas,
      array[feature_name],
      jsonb_build_object(
        'enabled_for_all', coalesce((feature_value ->> 'enabled_for_all')::boolean, false),
        'ordinary_daily_limit', ordinary_daily,
        'ordinary_weekly_limit', ordinary_weekly,
        'member_daily_limit', member_daily,
        'member_weekly_limit', member_weekly
      )
    );
  end loop;

  feature_value := normalized_feature_quotas -> 'assistant';
  ordinary_daily := (feature_value ->> 'ordinary_daily_limit')::integer;
  ordinary_weekly := (feature_value ->> 'ordinary_weekly_limit')::integer;
  member_daily := (feature_value ->> 'member_daily_limit')::integer;
  member_weekly := (feature_value ->> 'member_weekly_limit')::integer;

  insert into public.ai_assistant_settings as settings (
    id, enabled_for_all, daily_limit, weekly_limit,
    ordinary_daily_limit, ordinary_weekly_limit,
    member_daily_limit, member_weekly_limit,
    provider, model, mimo_channel,
    audio_provider, audio_model,
    feature_quotas, updated_at
  ) values (
    true, coalesce((feature_value ->> 'enabled_for_all')::boolean, p_enabled_for_all, false),
    ordinary_daily, ordinary_weekly,
    ordinary_daily, ordinary_weekly,
    member_daily, member_weekly,
    normalized_provider, normalized_model, normalized_mimo_channel,
    normalized_audio_provider, normalized_audio_model,
    normalized_feature_quotas, now()
  )
  on conflict (id) do update set
    enabled_for_all = excluded.enabled_for_all,
    daily_limit = excluded.daily_limit,
    weekly_limit = excluded.weekly_limit,
    ordinary_daily_limit = excluded.ordinary_daily_limit,
    ordinary_weekly_limit = excluded.ordinary_weekly_limit,
    member_daily_limit = excluded.member_daily_limit,
    member_weekly_limit = excluded.member_weekly_limit,
    provider = excluded.provider,
    model = excluded.model,
    mimo_channel = excluded.mimo_channel,
    audio_provider = excluded.audio_provider,
    audio_model = excluded.audio_model,
    feature_quotas = excluded.feature_quotas,
    updated_at = now()
  returning to_jsonb(settings.*) into result;

  return result;
end;
$$;

revoke all on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text, text, text, text, jsonb) from public;
grant execute on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text, text, text, text, jsonb) to authenticated;
