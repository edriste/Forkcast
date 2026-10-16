import { allowedEndpoint, deliveryAllowed, localClock, pushMessage, quietNow } from './policy.mjs';
let cursor = '00000000-0000-0000-0000-000000000000';
async function seedReminders(pool) {
  await pool.query(`insert into forkcast_private.push_events(dedupe,user_id,organization_id,event_id,deadline,category,available_at,expires_at)
    select 'deadline:'||e.id||':'||p.user_id||':'||e.signup_deadline,p.user_id,e.organization_id,e.id,e.signup_deadline,'deadlines',e.signup_deadline-interval '30 minutes',e.signup_deadline
    from public.cooking_events e join public.organization_memberships m on m.organization_id=e.organization_id
      join public.web_push_preferences p on p.user_id=m.user_id and p.enabled and p.deadlines
    where e.organizer_id<>p.user_id and e.signup_deadline>clock_timestamp() and e.signup_deadline<=clock_timestamp()+interval '30 minutes'
      and e.meal_date>=(clock_timestamp() at time zone 'Europe/Berlin')::date
      and not exists(select 1 from public.cooking_event_participants c where c.event_id=e.id and c.user_id=p.user_id)
    on conflict(dedupe) do nothing`);
  await pool.query(`insert into forkcast_private.push_events(dedupe,user_id,organization_id,event_id,order_id,notification_id,category,available_at,expires_at)
    select distinct on (p.user_id) 'payment:'||p.user_id||':'||floor(extract(epoch from clock_timestamp())/259200),p.user_id,n.organization_id,n.event_id,n.order_id,n.id,'payments',clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '3 days'
    from public.notifications n join public.web_push_preferences p on p.user_id=n.recipient_id and p.enabled and p.payments
    where n.kind in ('payment_due','order_payment_due') and n.created_at<clock_timestamp()-interval '1 day'
      and (p.last_payment_at is null or p.last_payment_at<clock_timestamp()-interval '3 days')
    order by p.user_id,n.created_at on conflict(dedupe) do nothing`);
  await pool.query(
    "delete from forkcast_private.push_events where expires_at<clock_timestamp()-interval '7 days'",
  );
}
async function claimForUser(pool, user, appOrigin) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      'select *,budget_day::text as budget_date from public.web_push_preferences where user_id=$1 for update skip locked',
      [user],
    );
    const prefs = result.rows[0];
    if (!prefs?.enabled) {
      await client.query('rollback');
      return null;
    }
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    const pending = (
      await client.query(
        `select q.*, e.signup_deadline as actual_deadline,o.signup_deadline as actual_order_deadline,e.meal_date,
      exists(select 1 from public.cooking_event_participants p where p.event_id=q.event_id and p.user_id=q.user_id) as joined
      from forkcast_private.push_events q left join public.cooking_events e on e.id=q.event_id left join public.office_orders o on o.id=q.order_id
      where q.user_id=$1 and q.handled_at is null and (q.available_at<=clock_timestamp() or (q.category in ('cooking','replies','organizer','payments') and q.available_at<=clock_timestamp()+interval '5 minutes')) and q.expires_at>clock_timestamp()
      order by (q.category='arrivals') desc,q.available_at limit 100`,
        [user],
      )
    ).rows;
    const visible = new Map();
    for (const org of new Set(pending.map((event) => event.organization_id))) {
      const member = (
        await client.query(
          'select 1 from public.organization_memberships where organization_id=$1 and user_id=$2',
          [org, user],
        )
      ).rowCount;
      if (!member) {
        visible.set(org, null);
        continue;
      }
      const inbox = (await client.query('select public.notification_inbox($1) as value', [org]))
        .rows[0].value;
      visible.set(org, new Set(inbox.items.filter((item) => !item.read_at).map((item) => item.id)));
    }
    const now = new Date();
    const accepted = [],
      discarded = [];
    for (const event of pending) {
      let valid =
        !!prefs[event.category] &&
        visible.get(event.organization_id) !== null &&
        new Date(event.created_at) >= new Date(prefs.enabled_at);
      if (event.notification_id)
        valid &&= visible.get(event.organization_id)?.has(event.notification_id);
      if (event.category === 'deadlines' && event.event_id)
        valid &&=
          !event.joined &&
          event.actual_deadline &&
          new Date(event.actual_deadline) > now &&
          +new Date(event.deadline) === +new Date(event.actual_deadline);
      if (event.category === 'deadlines' && event.order_id)
        valid &&= event.actual_order_deadline && new Date(event.actual_order_deadline) > now;
      if (event.category === 'cooking' && event.event_id && event.actual_deadline)
        valid &&= new Date(event.actual_deadline) > now;
      if (
        event.category === 'payments' &&
        prefs.last_payment_at &&
        now - new Date(prefs.last_payment_at) < 3 * 86400000
      )
        valid = false;
      (valid ? accepted : discarded).push(event);
    }
    // Users already active in Forkcast see the complete in-app inbox instead.
    if (prefs.last_active_at && now - new Date(prefs.last_active_at) < 90000) {
      discarded.push(...accepted);
      accepted.length = 0;
    }
    if (discarded.length)
      await client.query(
        'update forkcast_private.push_events set handled_at=clock_timestamp() where id=any($1::uuid[])',
        [discarded.map((event) => event.id)],
      );
    // node-postgres date columns are normalized to the user's ISO day for the cap.
    prefs.budget_day = prefs.budget_date;
    if (!accepted.length || !deliveryAllowed(prefs, accepted, now)) {
      await client.query('commit');
      return null;
    }
    const subscriptions = (
      await client.query('select * from public.web_push_subscriptions where user_id=$1', [user])
    ).rows;
    if (!subscriptions.length) {
      await client.query('commit');
      return null;
    }
    await client.query(
      'update forkcast_private.push_events set handled_at=clock_timestamp() where id=any($1::uuid[])',
      [accepted.map((event) => event.id)],
    );
    const day = localClock(now, prefs.timezone).day;
    await client.query(
      `update public.web_push_preferences set budget_day=$2::date,sent_today=case when budget_day=$2::date then sent_today+1 else 1 end,last_sent_at=clock_timestamp(),
      last_payment_at=case when $3 then clock_timestamp() else last_payment_at end where user_id=$1`,
      [user, day, accepted.some((event) => event.category === 'payments')],
    );
    await client.query('commit');
    return {
      user,
      events: accepted,
      subscriptions,
      message: pushMessage(accepted, prefs.locale, appOrigin),
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
async function deliver(pool, send, job) {
  for (const device of job.subscriptions) {
    if (!allowedEndpoint(device.endpoint)) {
      await pool.query('delete from public.web_push_subscriptions where id=$1', [device.id]);
      continue;
    }
    const active = await pool.query(
      `select p.* from public.web_push_subscriptions s join public.web_push_preferences p using(user_id)
      where s.id=$1 and s.user_id=$2 and p.enabled and exists(select 1 from public.organization_memberships m where m.user_id=s.user_id and m.organization_id=any($3::uuid[]))`,
      [device.id, job.user, job.events.map((event) => event.organization_id)],
    );
    if (
      !active.rowCount ||
      quietNow(active.rows[0], new Date()) ||
      job.events.every((event) => new Date(event.expires_at) <= new Date())
    )
      continue;
    try {
      await send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(job.message),
        {
          TTL: Math.max(
            1,
            Math.min(
              3600,
              ...job.events.map((event) =>
                Math.floor((new Date(event.expires_at) - Date.now()) / 1000),
              ),
            ),
          ),
          urgency: job.events.some((event) => event.category === 'arrivals') ? 'high' : 'normal',
          timeout: 10000,
        },
      );
    } catch (error) {
      if ([404, 410].includes(error.statusCode))
        await pool.query('delete from public.web_push_subscriptions where id=$1', [device.id]);
      // No ambiguous-send retry: failures still consume the reserved cap, preventing duplicate alerts.
      console.warn('Push delivery failed.', error.statusCode || 'transport');
    }
  }
}

export async function runCycle(pool, send, appOrigin) {
  await seedReminders(pool);
  const users = (
    await pool.query(
      `select p.user_id from public.web_push_preferences p where p.enabled
    and exists(select 1 from public.web_push_subscriptions s where s.user_id=p.user_id)
    and exists(select 1 from forkcast_private.push_events q where q.user_id=p.user_id and q.handled_at is null and q.available_at<=clock_timestamp() and q.expires_at>clock_timestamp())
    order by (p.user_id>$1::uuid) desc,p.user_id limit 100`,
      [cursor],
    )
  ).rows;
  if (users.length) cursor = users.at(-1).user_id;
  let count = 0;
  for (const { user_id } of users) {
    const job = await claimForUser(pool, user_id, appOrigin);
    if (job) {
      await deliver(pool, send, job);
      count++;
    }
  }
  return count;
}
