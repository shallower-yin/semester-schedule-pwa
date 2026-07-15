create or replace function public.admin_cleanup_transient_data(
  p_retention_days integer default 90,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retention_days integer := greatest(30, least(coalesce(p_retention_days, 90), 3650));
  cutoff_time timestamptz;
  ai_usage_deleted integer := 0;
  reminder_deliveries_deleted integer := 0;
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  if p_target_user_id is not null and not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception '没有找到该用户。' using errcode = 'P0002';
  end if;

  cutoff_time := now() - make_interval(days => retention_days);

  delete from public.ai_assistant_usage
  where requested_at < cutoff_time
    and (p_target_user_id is null or user_id = p_target_user_id);
  get diagnostics ai_usage_deleted = row_count;

  delete from public.reminder_deliveries
  where claimed_at < cutoff_time
    and (p_target_user_id is null or user_id = p_target_user_id);
  get diagnostics reminder_deliveries_deleted = row_count;

  return jsonb_build_object(
    'retentionDays', retention_days,
    'cutoff', cutoff_time,
    'targetUserId', p_target_user_id,
    'aiUsageDeleted', ai_usage_deleted,
    'reminderDeliveriesDeleted', reminder_deliveries_deleted
  );
end;
$$;

revoke all on function public.admin_cleanup_transient_data(integer, uuid) from public;
grant execute on function public.admin_cleanup_transient_data(integer, uuid) to authenticated;
