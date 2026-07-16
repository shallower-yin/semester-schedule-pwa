create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null default '',
  content text not null check (char_length(content) between 2 and 4000),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  admin_reply text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_feedback_user_created_idx
on public.user_feedback (user_id, created_at desc);

create index if not exists user_feedback_status_created_idx
on public.user_feedback (status, created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists "Users create own feedback" on public.user_feedback;
create policy "Users create own feedback"
on public.user_feedback for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own feedback" on public.user_feedback;
create policy "Users read own feedback"
on public.user_feedback for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "AI admins read all feedback" on public.user_feedback;
create policy "AI admins read all feedback"
on public.user_feedback for select to authenticated
using (public.is_ai_assistant_admin());

drop policy if exists "AI admins update feedback" on public.user_feedback;
create policy "AI admins update feedback"
on public.user_feedback for update to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());

grant select, insert, update on public.user_feedback to authenticated;
grant select, insert, update, delete on public.user_feedback to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own feedback attachments" on storage.objects;
create policy "Users upload own feedback attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own feedback attachments" on storage.objects;
create policy "Users read own feedback attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own feedback attachments" on storage.objects;
create policy "Users delete own feedback attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "AI admins read feedback attachments" on storage.objects;
create policy "AI admins read feedback attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-attachments'
  and public.is_ai_assistant_admin()
);
