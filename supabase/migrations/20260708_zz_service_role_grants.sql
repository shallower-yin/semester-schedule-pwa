do $$
declare
  table_name text;
  tables text[] := array[
    'semesters',
    'class_periods',
    'courses',
    'course_schedules',
    'course_cancellations',
    'categories',
    'events',
    'event_occurrence_states',
    'anniversaries',
    'memo_folders',
    'memos',
    'focus_settings',
    'focus_sessions'
  ];
begin
  foreach table_name in array tables loop
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end
$$;

grant select, insert, update, delete on public.ai_assistant_access to service_role;
grant usage on schema public to service_role;
