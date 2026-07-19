alter table public.health_profiles
  add column if not exists exercise_items jsonb not null
  default '["俯卧撑", "仰卧起坐", "深蹲"]'::jsonb;

alter table public.health_profiles
  drop constraint if exists health_profiles_exercise_items_check;

alter table public.health_profiles
  add constraint health_profiles_exercise_items_check
  check (
    jsonb_typeof(exercise_items) = 'array'
    and jsonb_array_length(exercise_items) between 1 and 12
  );
