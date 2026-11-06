-- Generated from lunar-typescript 1.8.7 solar-term dates for 1900-2100.
-- This private pure helper is called inside the reminder SECURITY DEFINER RPC.
create or replace function public.qingming_date_for_year(target_year integer)
returns date
language sql
immutable
strict
set search_path = public, pg_temp
as $qingming$
  select case when target_year between 1900 and 2100 then
    make_date(target_year, 4, (array[
      5, 5, 6, 6, 5, 5, 6, 6, 5, 5, -- 1900-1909
      6, 6, 5, 5, 5, 6, 5, 5, 5, 6, -- 1910-1919
      5, 5, 5, 6, 5, 5, 5, 6, 5, 5, -- 1920-1929
      5, 6, 5, 5, 5, 6, 5, 5, 5, 6, -- 1930-1939
      5, 5, 5, 6, 5, 5, 5, 5, 5, 5, -- 1940-1949
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, -- 1950-1959
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, -- 1960-1969
      5, 5, 5, 5, 5, 5, 4, 5, 5, 5, -- 1970-1979
      4, 5, 5, 5, 4, 5, 5, 5, 4, 5, -- 1980-1989
      5, 5, 4, 5, 5, 5, 4, 5, 5, 5, -- 1990-1999
      4, 5, 5, 5, 4, 5, 5, 5, 4, 4, -- 2000-2009
      5, 5, 4, 4, 5, 5, 4, 4, 5, 5, -- 2010-2019
      4, 4, 5, 5, 4, 4, 5, 5, 4, 4, -- 2020-2029
      5, 5, 4, 4, 5, 5, 4, 4, 5, 5, -- 2030-2039
      4, 4, 4, 5, 4, 4, 4, 5, 4, 4, -- 2040-2049
      4, 5, 4, 4, 4, 5, 4, 4, 4, 5, -- 2050-2059
      4, 4, 4, 5, 4, 4, 4, 5, 4, 4, -- 2060-2069
      4, 5, 4, 4, 4, 4, 4, 4, 4, 4, -- 2070-2079
      4, 4, 4, 4, 4, 4, 4, 4, 4, 4, -- 2080-2089
      4, 4, 4, 4, 4, 4, 4, 4, 4, 4, -- 2090-2099
      5 -- 2100
    ])[target_year - 1899])
  else null end;
$qingming$;

revoke all on function public.qingming_date_for_year(integer) from public, anon, authenticated;

-- Patch the installed RPC rather than recreating an old copy. All unrelated
-- security checks, return types, configuration and existing grants stay intact.
do $patch$
declare
  function_oid oid := to_regprocedure('public.claim_due_reminders(text)');
  function_definition text;
  source_pattern text := 'public\.anniversary_date_for_year\s*\(\s*anniversary\.date\s*,\s*year\.value\s*\)';
  replacement_expression text := $expression$case
        when anniversary.kind = 'holiday'
          and regexp_replace(anniversary.title, '[[:space:]]', '', 'g') ~ '^([0-9]{4}年)?清明节?$'
        then public.qingming_date_for_year(year.value)
        else public.anniversary_date_for_year(anniversary.date, year.value)
      end$expression$;
  lunar_pattern text := 'where\s+anniversary\.calendar_type\s*=\s*''lunar''';
  replacement_lunar text := $lunar$where anniversary.calendar_type = 'lunar'
        and not (anniversary.kind = 'holiday'
          and regexp_replace(anniversary.title, '[[:space:]]', '', 'g') ~ '^([0-9]{4}年)?清明节?$')$lunar$;
  solar_pattern text := 'where\s+coalesce\s*\(\s*anniversary\.calendar_type\s*,\s*''solar''\s*\)\s*<>\s*''lunar''';
  replacement_solar text := $solar$where (coalesce(anniversary.calendar_type, 'solar') <> 'lunar'
        or (anniversary.kind = 'holiday'
          and regexp_replace(anniversary.title, '[[:space:]]', '', 'g') ~ '^([0-9]{4}年)?清明节?$'))$solar$;
  lower_pattern text := 'occurrence\.occurrence_date\s*>=\s*anniversary\.date';
  replacement_lower text := $lower$occurrence.occurrence_date >= case
        when anniversary.kind = 'holiday'
          and regexp_replace(anniversary.title, '[[:space:]]', '', 'g') ~ '^([0-9]{4}年)?清明节?$'
        then public.qingming_date_for_year(extract(year from anniversary.date)::integer)
        else anniversary.date
      end$lower$;
  source_matches integer;
  lunar_matches integer;
  solar_matches integer;
  lower_matches integer;
begin
  if function_oid is null then
    raise exception 'Qingming reminder migration requires claim_due_reminders(text)';
  end if;
  function_definition := pg_get_functiondef(function_oid);

  if position('public.qingming_date_for_year' in function_definition) > 0 then
    if position(replacement_expression in function_definition) = 0
      or position(replacement_lunar in function_definition) = 0
      or position(replacement_solar in function_definition) = 0
      or position(replacement_lower in function_definition) = 0 then
      raise exception 'Qingming reminder migration found an unexpected existing patch';
    end if;
    return;
  end if;

  select count(*) into source_matches
  from regexp_matches(function_definition, source_pattern, 'g');
  select count(*) into lunar_matches
  from regexp_matches(function_definition, lunar_pattern, 'g');
  select count(*) into solar_matches
  from regexp_matches(function_definition, solar_pattern, 'g');
  select count(*) into lower_matches
  from regexp_matches(function_definition, lower_pattern, 'g');
  if source_matches <> 1 or lunar_matches <> 1 or solar_matches <> 1 or lower_matches <> 1 then
    raise exception 'Qingming reminder migration expected 1 annual date / lunar branch / solar branch / lower bound, found % / % / % / %',
      source_matches, lunar_matches, solar_matches, lower_matches;
  end if;
  -- Use literal replacement after the regex count assertion. PostgreSQL's
  -- regexp_replace replacement syntax treats backslashes specially and can
  -- corrupt the regex anchors in the Qingming title expression.
  function_definition := replace(function_definition,
    'public.anniversary_date_for_year(anniversary.date, year.value)',
    replacement_expression);
  function_definition := replace(function_definition,
    'where anniversary.calendar_type = ''lunar''',
    replacement_lunar);
  function_definition := replace(function_definition,
    'where coalesce(anniversary.calendar_type, ''solar'') <> ''lunar''',
    replacement_solar);
  function_definition := replace(function_definition,
    'occurrence.occurrence_date >= anniversary.date',
    replacement_lower);
  execute function_definition;
end;
$patch$;
