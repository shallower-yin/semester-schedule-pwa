insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-avatars',
  'account-avatars',
  true,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own account avatar" on storage.objects;
create policy "Users upload own account avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own account avatar metadata" on storage.objects;
create policy "Users read own account avatar metadata"
on storage.objects for select to authenticated
using (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own account avatar" on storage.objects;
create policy "Users update own account avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own account avatar" on storage.objects;
create policy "Users delete own account avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'account-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
