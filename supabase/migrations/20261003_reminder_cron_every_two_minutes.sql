-- Run the closed-app reminder dispatcher every two minutes.
-- The event, anniversary, and todo claim paths keep a 15-minute due window;
-- health reminders keep their existing three-minute window, which covers the
-- two-minute cadence while retaining their current delivery semantics.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

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
    '*/2 * * * *',
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
          ),
          'x-reminder-dispatcher-token', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'schedule_dispatcher_token'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 30000
      );
    $job$
  );
end
$$;
