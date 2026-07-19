alter table public.memos
add column if not exists images jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memos_images_array_check'
      and conrelid = 'public.memos'::regclass
  ) then
    alter table public.memos
    add constraint memos_images_array_check check (jsonb_typeof(images) = 'array');
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memo-images',
  'memo-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own memo images" on storage.objects;
create policy "Users upload own memo images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'memo-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own memo images" on storage.objects;
create policy "Users read own memo images"
on storage.objects for select to authenticated
using (
  bucket_id = 'memo-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own memo images" on storage.objects;
create policy "Users delete own memo images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'memo-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create table if not exists public.feedback_channel_settings (
  id text primary key default 'default' check (id = 'default'),
  recommended_channel text not null default '' check (char_length(recommended_channel) <= 300),
  updated_at timestamptz not null default now()
);

insert into public.feedback_channel_settings (id, recommended_channel)
values ('default', '')
on conflict (id) do nothing;

alter table public.feedback_channel_settings enable row level security;

drop policy if exists "Everyone reads feedback channel" on public.feedback_channel_settings;
create policy "Everyone reads feedback channel"
on public.feedback_channel_settings for select to anon, authenticated
using (true);

drop policy if exists "AI admins update feedback channel" on public.feedback_channel_settings;
create policy "AI admins update feedback channel"
on public.feedback_channel_settings for update to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

grant select on public.feedback_channel_settings to anon, authenticated;
grant update on public.feedback_channel_settings to authenticated;
grant select, insert, update, delete on public.feedback_channel_settings to service_role;
