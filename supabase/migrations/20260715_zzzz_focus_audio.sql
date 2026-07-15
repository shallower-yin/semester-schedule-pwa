create table if not exists public.focus_audio_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('white_noise', 'music')),
  storage_path text not null unique,
  mime_type text not null default 'audio/mpeg',
  file_size bigint not null default 0 check (file_size >= 0),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.focus_audio_tracks enable row level security;

drop policy if exists "Authenticated users read focus audio" on public.focus_audio_tracks;
drop policy if exists "Anyone reads focus audio" on public.focus_audio_tracks;
create policy "Anyone reads focus audio"
on public.focus_audio_tracks for select to anon, authenticated
using (true);

drop policy if exists "Admins manage focus audio" on public.focus_audio_tracks;
create policy "Admins manage focus audio"
on public.focus_audio_tracks for all to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

grant select on public.focus_audio_tracks to anon, authenticated;
grant insert, update, delete on public.focus_audio_tracks to authenticated;
grant all on public.focus_audio_tracks to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'focus-audio',
  'focus-audio',
  true,
  52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins upload focus audio objects" on storage.objects;
create policy "Admins upload focus audio objects"
on storage.objects for insert to authenticated
with check (bucket_id = 'focus-audio' and public.is_ai_assistant_admin());

drop policy if exists "Admins update focus audio objects" on storage.objects;
create policy "Admins update focus audio objects"
on storage.objects for update to authenticated
using (bucket_id = 'focus-audio' and public.is_ai_assistant_admin())
with check (bucket_id = 'focus-audio' and public.is_ai_assistant_admin());

drop policy if exists "Admins delete focus audio objects" on storage.objects;
create policy "Admins delete focus audio objects"
on storage.objects for delete to authenticated
using (bucket_id = 'focus-audio' and public.is_ai_assistant_admin());
