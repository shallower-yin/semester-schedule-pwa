-- Preserve legacy invalid references for explicit recovery. NOT VALID skips
-- historical rows, while enforcing all new/changed category references.
-- Do not VALIDATE until legacy references have been reviewed and repaired.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass and conname = 'events_category_owner_fkey'
  ) then
    alter table public.events add constraint events_category_owner_fkey
      foreign key (category_id, user_id) references public.categories(id, user_id)
      on delete set null (category_id) not valid;
  end if;
end;
$$;
