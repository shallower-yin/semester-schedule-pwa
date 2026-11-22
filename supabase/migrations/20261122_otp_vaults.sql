-- Clients encrypt the entire vault. This table never stores TOTP seeds or
-- account labels in plaintext; the separate unlock password stays client-side.
create table if not exists public.otp_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1100000),
  updated_at timestamptz not null default now()
);

alter table public.otp_vaults enable row level security;
revoke all on public.otp_vaults from public, anon, authenticated;
grant select on public.otp_vaults to authenticated;
drop policy if exists "Read own encrypted OTP vault" on public.otp_vaults;
create policy "Read own encrypted OTP vault" on public.otp_vaults
  for select to authenticated using ((select auth.uid()) = user_id);

-- All writes use compare-and-swap. An explicit owner also rejects an account
-- switch that occurs between preparing ciphertext and issuing the request.
create or replace function public.save_otp_vault(
  p_owner_id uuid, p_expected_revision bigint, p_payload jsonb
)
returns table (user_id uuid, revision bigint, payload jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'OTP vault owner mismatch' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid OTP vault revision' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - array['version', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'] <> '{}'::jsonb
    or p_payload ->> 'version' is distinct from '1'
    or p_payload ->> 'kdf' is distinct from 'PBKDF2-SHA256'
    or p_payload ->> 'iterations' is distinct from '600000'
    or length(coalesce(p_payload ->> 'salt', '')) <> 24
    or length(coalesce(p_payload ->> 'iv', '')) <> 16
    or length(coalesce(p_payload ->> 'ciphertext', '')) not between 24 and 1000000
    or octet_length(p_payload::text) > 1100000 then
    raise exception 'Invalid encrypted OTP vault' using errcode = '22023';
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
