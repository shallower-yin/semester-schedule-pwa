import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.test("课程提醒迁移、教学周计算、停课过滤与云端去重", async (t) => {
  const db = await PGlite.create();
  const alice = "00000000-0000-0000-0000-000000000001";
  const bob = "00000000-0000-0000-0000-000000000002";
  const semester = "00000000-0000-0000-0000-000000000003";
  const course = "00000000-0000-0000-0000-000000000004";
  const schedule = "00000000-0000-0000-0000-000000000005";
  const claim = () => db.query<{ delivery_id: string; source_id: string; course_schedule_id: string; user_id: string; occurrence_date: string; start_time: string; title: string; location: string }>("select * from claim_due_course_reminders('test-token')");
  try {
    await db.exec(`
      create role anon;
      -- Only the digest primitive is stubbed; the migrated RPC still validates tokens.
      create function digest(value text, algorithm text) returns bytea language sql as $$
        select case when value = 'test-token' then decode('68e9790b77b3168da715f915a3925664b67b66b23ab0dfb3fe301d1d84da91d7', 'hex') else decode('', 'hex') end
      $$;
      create table semesters(id uuid primary key, user_id uuid, start_date date, total_weeks smallint, deleted_at timestamptz);
      create table courses(id uuid primary key, user_id uuid, semester_id uuid, name text, classroom text, deleted_at timestamptz);
      create table course_schedules(id uuid primary key, user_id uuid, course_id uuid, weekday smallint, start_period smallint, weeks smallint[], deleted_at timestamptz, unique(id,user_id));
      create table class_periods(id uuid primary key, user_id uuid, semester_id uuid, weekday smallint, period_number smallint, kind text, sort_order int, start_time time, deleted_at timestamptz);
      create table course_cancellations(course_schedule_id uuid, user_id uuid, occurrence_date date, deleted_at timestamptz);
      create table push_subscriptions(user_id uuid, endpoint text, p256dh text, auth text, deleted_at timestamptz);
      create table reminder_deliveries(id uuid primary key, user_id uuid, event_id uuid, anniversary_id uuid, todo_id uuid, occurrence_date date, reminder_at timestamptz, claimed_at timestamptz, status text,
        constraint reminder_deliveries_single_source_check check(num_nonnulls(event_id,anniversary_id,todo_id)=1));
      insert into semesters values ('${semester}','${alice}',date_trunc('week',now() at time zone 'Asia/Shanghai')::date,4,null);
      insert into courses values ('${course}','${alice}','${semester}','新材料制造学','55楼A区308',null);
      insert into course_schedules values ('${schedule}','${alice}','${course}',extract(isodow from now() at time zone 'Asia/Shanghai'),1,array[1,3],null);
      insert into class_periods values (gen_random_uuid(),'${alice}','${semester}',extract(isodow from now() at time zone 'Asia/Shanghai'),1,'period',1,(now() at time zone 'Asia/Shanghai')::time,null);
      insert into push_subscriptions values ('${alice}','device-a','key','auth',null),('${alice}','device-b','key','auth',null),('${bob}','other-user','key','auth',null);
      insert into reminder_deliveries values (gen_random_uuid(),'${alice}',gen_random_uuid(),null,null,current_date,now(),now(),'delivered');
    `);
    const migration = await Deno.readTextFile(new URL("../../migrations/20261119_course_reminders.sql", import.meta.url));
    await db.exec(migration);
    await db.exec(migration);

    await t.step("重复执行保留旧数据，旧课程默认关闭，拒绝无效调度令牌", async () => {
      assertEquals((await db.query("select reminder_enabled,reminder_minutes_before from courses")).rows, [{ reminder_enabled: false, reminder_minutes_before: 10 }]);
      assertEquals((await db.query("select count(*)::int as count from reminder_deliveries")).rows, [{ count: 1 }]);
      assertEquals((await claim()).rows.length, 0);
      await assertRejects(() => db.query("select * from claim_due_course_reminders('wrong')"), Error, "invalid dispatcher token");
      await assertRejects(() => db.query("select * from claim_due_course_reminders(null)"), Error, "invalid dispatcher token");
    });

    await t.step("排除未选教学周、已删节次、学期开始前与停课日期", async () => {
      await db.exec("update courses set reminder_enabled=true,reminder_minutes_before=0; update course_schedules set weeks=array[2]::smallint[]");
      assertEquals((await claim()).rows.length, 0);
      await db.exec("update course_schedules set weeks=array[1,3]::smallint[]; update class_periods set deleted_at=now()");
      assertEquals((await claim()).rows.length, 0);
      await db.exec("update class_periods set deleted_at=null; update semesters set start_date=(now() at time zone 'Asia/Shanghai')::date+1");
      assertEquals((await claim()).rows.length, 0);
      await db.exec("update semesters set start_date=date_trunc('week',now() at time zone 'Asia/Shanghai')::date");
      await db.exec(`insert into course_cancellations values ('${schedule}','${alice}',(now() at time zone 'Asia/Shanghai')::date,null)`);
      assertEquals((await claim()).rows.length, 0);
      await db.exec("update course_cancellations set deleted_at=now()");
    });

    await t.step("每次上课只认领一次，按当前课程的时间和教室发送至本人的设备", async () => {
      const rows = (await claim()).rows;
      assertEquals(rows.length, 2);
      assertEquals(rows[0].source_id, course);
      assertEquals(rows[0].course_schedule_id, schedule);
      assertEquals(rows[0].user_id, alice);
      assertEquals(rows[0].title, "新材料制造学");
      assertEquals(rows[0].location, "55楼A区308");
      assertEquals(rows[0].delivery_id, rows[1].delivery_id);
      assertEquals((await claim()).rows.length, 0);
    });

    await t.step("提前七天仍计算正确的未来上课日期，关闭后不再认领", async () => {
      await db.exec("update course_schedules set weeks=array[2]::smallint[]; update courses set reminder_minutes_before=10080");
      const rows = (await claim()).rows;
      assertEquals(rows.length, 2);
      const expected = (await db.query<{ date: string }>("select ((now() at time zone 'Asia/Shanghai')::date+7)::text as date")).rows[0].date;
      assertEquals(new Date(rows[0].occurrence_date).toISOString().slice(0, 10), expected);
      await db.exec("delete from reminder_deliveries where course_schedule_id is not null; update courses set reminder_enabled=false");
      assertEquals((await claim()).rows.length, 0);
    });

    await t.step("投递记录限制单一来源及同账号引用，删除安排会级联移除提醒", async () => {
      await assertRejects(() => db.exec(`insert into reminder_deliveries(id,user_id,course_schedule_id) values(gen_random_uuid(),'${bob}','${schedule}')`), Error, "foreign key");
      await assertRejects(() => db.exec(`insert into reminder_deliveries(id,user_id,course_schedule_id,event_id) values(gen_random_uuid(),'${alice}','${schedule}',gen_random_uuid())`), Error, "check constraint");
      await db.exec("update courses set reminder_enabled=true");
      assertEquals((await claim()).rows.length, 2);
      await db.exec("delete from course_schedules");
      assertEquals((await db.query("select count(*)::int as count from reminder_deliveries")).rows, [{ count: 1 }]);
    });
  } finally { await db.close(); }
});
