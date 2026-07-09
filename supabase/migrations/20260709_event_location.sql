alter table public.events
  add column if not exists location text not null default '';
