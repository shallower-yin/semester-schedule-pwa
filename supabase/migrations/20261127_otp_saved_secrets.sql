-- Version 2 stores user-owned keys under the existing authenticated-owner RLS.
-- Keep accepting legacy encrypted envelopes while clients migrate.
create or replace function public.save_otp_vault(
  p_owner_id uuid, p_expected_revision bigint, p_payload jsonb
)
returns table (user_id uuid, revision bigint, payload jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_ids text[] := array[]::text[];
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'OTP vault owner mismatch' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid OTP vault revision' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text) > 1100000 then
    raise exception 'Invalid OTP vault payload' using errcode = '22023';
  end if;

  if p_payload ->> 'version' = '1' then
    if p_payload - array['version', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'] <> '{}'::jsonb
      or p_payload ->> 'kdf' is distinct from 'PBKDF2-SHA256'
      or p_payload ->> 'iterations' is distinct from '600000'
      or length(coalesce(p_payload ->> 'salt', '')) <> 24
      or length(coalesce(p_payload ->> 'iv', '')) <> 16
      or length(coalesce(p_payload ->> 'ciphertext', '')) not between 24 and 1000000 then
      raise exception 'Invalid encrypted OTP vault' using errcode = '22023';
    end if;
  elsif p_payload -> 'version' = '2'::jsonb then
    if p_payload - array['version', 'items'] <> '{}'::jsonb
      or jsonb_typeof(p_payload -> 'items') is distinct from 'array' then
      raise exception 'Invalid OTP vault document' using errcode = '22023';
    end if;
    if jsonb_array_length(p_payload -> 'items') > 1000 then
      raise exception 'Too many OTP vault items' using errcode = '22023';
    end if;
    for v_item in select jsonb_array_elements(p_payload -> 'items') loop
      if jsonb_typeof(v_item) is distinct from 'object'
        or jsonb_typeof(v_item -> 'id') is distinct from 'string'
        or length(v_item ->> 'id') not between 1 and 128
        or (v_item ->> 'id') = any(v_ids)
        or jsonb_typeof(v_item -> 'updatedAt') is distinct from 'string'
        or length(v_item ->> 'updatedAt') not between 1 and 64 then
        raise exception 'Invalid OTP vault item' using errcode = '22023';
      end if;
      v_ids := array_append(v_ids, v_item ->> 'id');
      if v_item -> 'deleted' = 'true'::jsonb then
        if v_item - array['id', 'updatedAt', 'deleted'] <> '{}'::jsonb then
          raise exception 'Invalid OTP vault deletion' using errcode = '22023';
        end if;
        continue;
      end if;
      if v_item - array['id', 'updatedAt', 'kind', 'issuer', 'account', 'secret', 'algorithm', 'digits', 'period'] <> '{}'::jsonb
        or v_item ? 'deleted'
        or jsonb_typeof(v_item -> 'issuer') is distinct from 'string'
        or jsonb_typeof(v_item -> 'account') is distinct from 'string'
        or jsonb_typeof(v_item -> 'secret') is distinct from 'string'
        or length(v_item ->> 'issuer') > 80
        or length(v_item ->> 'account') > 160
        or (btrim(v_item ->> 'issuer') = '' and btrim(v_item ->> 'account') = '')
        or length(v_item ->> 'secret') not between 1 and 16384
        or btrim(v_item ->> 'secret') = ''
        or coalesce(v_item ->> 'kind', '') not in ('totp', 'secret') then
        raise exception 'Invalid saved key' using errcode = '22023';
      end if;
      if v_item ->> 'kind' = 'totp' then
        if coalesce(v_item ->> 'algorithm', '') not in ('SHA1', 'SHA256', 'SHA512')
          or coalesce(v_item -> 'digits', 'null'::jsonb) not in ('6'::jsonb, '8'::jsonb)
          or jsonb_typeof(v_item -> 'period') is distinct from 'number' then
          raise exception 'Invalid TOTP parameters' using errcode = '22023';
        end if;
        if (v_item ->> 'period')::numeric not between 1 and 3600
          or (v_item ->> 'period')::numeric <> trunc((v_item ->> 'period')::numeric)
          or length(v_item ->> 'secret') not between 16 and 512
          or (v_item ->> 'secret') !~ '^[A-Z2-7]+$' then
          raise exception 'Invalid TOTP parameters' using errcode = '22023';
        end if;
      elsif v_item ?| array['algorithm', 'digits', 'period'] then
        raise exception 'Unexpected TOTP parameters on saved token' using errcode = '22023';
      end if;
    end loop;
  else
    raise exception 'Unsupported OTP vault version' using errcode = '22023';
  end if;

  if p_expected_revision = 0 then
    return query
      insert into public.otp_vaults as vault (user_id, payload)
      values (p_owner_id, p_payload)
      on conflict do nothing
      returning vault.user_id, vault.revision, vault.payload, vault.updated_at;
  else
    return query
      update public.otp_vaults as vault
      set revision = vault.revision + 1, payload = p_payload, updated_at = clock_timestamp()
      where vault.user_id = p_owner_id and vault.revision = p_expected_revision
      returning vault.user_id, vault.revision, vault.payload, vault.updated_at;
  end if;
end;
$$;

revoke all on function public.save_otp_vault(uuid, bigint, jsonb) from public, anon;
grant execute on function public.save_otp_vault(uuid, bigint, jsonb) to authenticated;
