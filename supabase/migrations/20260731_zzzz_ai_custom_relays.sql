create table if not exists public.ai_provider_relays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  protocol text not null,
  base_url text not null,
  api_key_secret_id uuid not null,
  supports_text boolean not null default true,
  text_model text,
  supports_audio boolean not null default false,
  audio_model text,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_message text,
  last_test_latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_provider_relays_name_check check (char_length(trim(name)) between 1 and 80),
  constraint ai_provider_relays_protocol_check check (protocol in ('openai_compatible', 'deepseek', 'mimo')),
  constraint ai_provider_relays_base_url_check check (
    char_length(base_url) between 9 and 500
    and base_url ~ '^https://'
  ),
  constraint ai_provider_relays_capability_check check (supports_text or supports_audio),
  constraint ai_provider_relays_text_model_check check (
    (supports_text and char_length(trim(coalesce(text_model, ''))) between 1 and 160)
    or (not supports_text and text_model is null)
  ),
  constraint ai_provider_relays_audio_model_check check (
    (supports_audio and protocol in ('openai_compatible', 'mimo') and char_length(trim(coalesce(audio_model, ''))) between 1 and 160)
    or (not supports_audio and audio_model is null)
  ),
  constraint ai_provider_relays_test_status_check check (
    last_test_status is null or last_test_status in ('success', 'error')
  ),
  constraint ai_provider_relays_test_latency_check check (
    last_test_latency_ms is null or last_test_latency_ms between 0 and 300000
  )
);

alter table public.ai_provider_relays enable row level security;
revoke all on public.ai_provider_relays from anon, authenticated;
grant select, insert, update, delete on public.ai_provider_relays to service_role;

alter table public.ai_assistant_settings
  add column if not exists text_relay_id uuid references public.ai_provider_relays(id) on delete set null,
  add column if not exists audio_relay_id uuid references public.ai_provider_relays(id) on delete set null;

create or replace function public.admin_upsert_ai_provider_relay(
  p_id uuid,
  p_name text,
  p_protocol text,
  p_base_url text,
  p_api_key text,
  p_supports_text boolean,
  p_text_model text,
  p_supports_audio boolean,
  p_audio_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  relay_id uuid := coalesce(p_id, gen_random_uuid());
  previous_secret_id uuid;
  next_secret_id uuid;
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_protocol text := lower(trim(coalesce(p_protocol, '')));
  normalized_base_url text := regexp_replace(trim(coalesce(p_base_url, '')), '/+$', '');
  normalized_api_key text := trim(coalesce(p_api_key, ''));
  normalized_text_model text := nullif(trim(coalesce(p_text_model, '')), '');
  normalized_audio_model text := nullif(trim(coalesce(p_audio_model, '')), '');
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_id is not null then
    select api_key_secret_id into previous_secret_id
    from public.ai_provider_relays
    where id = p_id;
    if not found then
      raise exception 'AI relay not found.' using errcode = 'P0002';
    end if;
  end if;

  if normalized_api_key <> '' then
    select vault.create_secret(
      normalized_api_key,
      'ai_provider_relay_' || relay_id::text || '_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
      'Custom AI relay credential'
    ) into next_secret_id;
  elsif previous_secret_id is not null then
    next_secret_id := previous_secret_id;
  else
    raise exception 'API key is required for a new relay.' using errcode = '22023';
  end if;

  insert into public.ai_provider_relays as relay (
    id, name, protocol, base_url, api_key_secret_id,
    supports_text, text_model, supports_audio, audio_model,
    created_at, updated_at
  ) values (
    relay_id, normalized_name, normalized_protocol, normalized_base_url, next_secret_id,
    coalesce(p_supports_text, false),
    case when coalesce(p_supports_text, false) then normalized_text_model else null end,
    coalesce(p_supports_audio, false),
    case when coalesce(p_supports_audio, false) then normalized_audio_model else null end,
    now(), now()
  )
  on conflict (id) do update set
    name = excluded.name,
    protocol = excluded.protocol,
    base_url = excluded.base_url,
    api_key_secret_id = excluded.api_key_secret_id,
    supports_text = excluded.supports_text,
    text_model = excluded.text_model,
    supports_audio = excluded.supports_audio,
    audio_model = excluded.audio_model,
    last_tested_at = case
      when relay.base_url is distinct from excluded.base_url
        or relay.protocol is distinct from excluded.protocol
        or relay.api_key_secret_id is distinct from excluded.api_key_secret_id
        or relay.text_model is distinct from excluded.text_model
        or relay.audio_model is distinct from excluded.audio_model
      then null else relay.last_tested_at end,
    last_test_status = case
      when relay.base_url is distinct from excluded.base_url
        or relay.protocol is distinct from excluded.protocol
        or relay.api_key_secret_id is distinct from excluded.api_key_secret_id
        or relay.text_model is distinct from excluded.text_model
        or relay.audio_model is distinct from excluded.audio_model
      then null else relay.last_test_status end,
    last_test_message = case
      when relay.base_url is distinct from excluded.base_url
        or relay.protocol is distinct from excluded.protocol
        or relay.api_key_secret_id is distinct from excluded.api_key_secret_id
        or relay.text_model is distinct from excluded.text_model
        or relay.audio_model is distinct from excluded.audio_model
      then null else relay.last_test_message end,
    last_test_latency_ms = case
      when relay.base_url is distinct from excluded.base_url
        or relay.protocol is distinct from excluded.protocol
        or relay.api_key_secret_id is distinct from excluded.api_key_secret_id
        or relay.text_model is distinct from excluded.text_model
        or relay.audio_model is distinct from excluded.audio_model
      then null else relay.last_test_latency_ms end,
    updated_at = now();

  if previous_secret_id is not null and previous_secret_id <> next_secret_id then
    delete from vault.secrets where id = previous_secret_id;
  end if;

  select jsonb_build_object(
    'id', item.id,
    'name', item.name,
    'protocol', item.protocol,
    'base_url', item.base_url,
    'key_configured', true,
    'supports_text', item.supports_text,
    'text_model', item.text_model,
    'supports_audio', item.supports_audio,
    'audio_model', item.audio_model,
    'last_tested_at', item.last_tested_at,
    'last_test_status', item.last_test_status,
    'last_test_message', item.last_test_message,
    'last_test_latency_ms', item.last_test_latency_ms,
    'created_at', item.created_at,
    'updated_at', item.updated_at
  ) into result
  from public.ai_provider_relays item
  where item.id = relay_id;

  return result;
exception
  when others then
    if next_secret_id is not null and next_secret_id is distinct from previous_secret_id then
      delete from vault.secrets where id = next_secret_id;
    end if;
    raise;
end;
$$;

create or replace function public.admin_delete_ai_provider_relay(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select api_key_secret_id into secret_id
  from public.ai_provider_relays
  where id = p_id
  for update;
  if not found then return; end if;
  delete from public.ai_provider_relays where id = p_id;
  delete from vault.secrets where id = secret_id;
end;
$$;

create or replace function public.get_ai_provider_relay_runtime(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', relay.id,
    'name', relay.name,
    'protocol', relay.protocol,
    'base_url', relay.base_url,
    'api_key', secret.decrypted_secret,
    'supports_text', relay.supports_text,
    'text_model', relay.text_model,
    'supports_audio', relay.supports_audio,
    'audio_model', relay.audio_model
  ) into result
  from public.ai_provider_relays relay
  join vault.decrypted_secrets secret on secret.id = relay.api_key_secret_id
  where relay.id = p_id;
  return result;
end;
$$;

create or replace function public.get_ai_runtime_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select to_jsonb(settings)
    || jsonb_build_object(
      'text_relay', case when settings.text_relay_id is null then null
        else public.get_ai_provider_relay_runtime(settings.text_relay_id) end,
      'audio_relay', case when settings.audio_relay_id is null then null
        else public.get_ai_provider_relay_runtime(settings.audio_relay_id) end
    )
  into result
  from public.ai_assistant_settings settings
  where settings.id = true;
  return result;
end;
$$;

revoke all on function public.admin_upsert_ai_provider_relay(uuid, text, text, text, text, boolean, text, boolean, text) from public;
revoke all on function public.admin_delete_ai_provider_relay(uuid) from public;
revoke all on function public.get_ai_provider_relay_runtime(uuid) from public;
revoke all on function public.get_ai_runtime_settings() from public;
grant execute on function public.admin_upsert_ai_provider_relay(uuid, text, text, text, text, boolean, text, boolean, text) to service_role;
grant execute on function public.admin_delete_ai_provider_relay(uuid) to service_role;
grant execute on function public.get_ai_provider_relay_runtime(uuid) to service_role;
grant execute on function public.get_ai_runtime_settings() to service_role;
