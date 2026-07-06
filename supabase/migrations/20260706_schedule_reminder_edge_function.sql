create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://haifsnaupqhlvgfoyvlc.supabase.co',
  'schedule_project_url',
  '日程提醒 Edge Function 的项目地址'
)
where not exists (
  select 1 from vault.secrets where name = 'schedule_project_url'
);

select vault.create_secret(
  'sb_publishable_eeUg5BLorea3z7jicaPsHg_sEy19yWj',
  'schedule_publishable_key',
  '日程提醒 Cron 调用 Edge Function 使用的公开密钥'
)
where not exists (
  select 1 from vault.secrets where name = 'schedule_publishable_key'
);

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'dispatch-schedule-reminders'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'dispatch-schedule-reminders',
    '* * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'schedule_project_url'
        ) || '/functions/v1/send-reminders',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'schedule_publishable_key'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 30000
      );
    $job$
  );
end
$$;
