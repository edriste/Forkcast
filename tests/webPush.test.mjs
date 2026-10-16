import { expect, test } from 'vitest';
import {
  allowedEndpoint,
  deliveryAllowed,
  localClock,
  pushMessage,
  quietNow,
} from '../deploy/push/policy.mjs';
import { runCycle } from '../deploy/push/delivery.mjs';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap } from './bootstrap';
import { migrate } from '../scripts/migrate.mjs';
import { resolve } from 'node:path';
const prefs = {
  enabled: true,
  timezone: 'Europe/Berlin',
  quiet_start: 22,
  quiet_end: 8,
  daily_limit: 3,
  budget_day: null,
  sent_today: 0,
  last_sent_at: null,
};
const noon = new Date('2026-10-16T10:00:00Z');
test('push policy enforces local quiet hours, hard account caps, spacing and limited urgent exceptions', () => {
  expect(quietNow(prefs, new Date('2026-10-16T21:00:00Z'))).toBe(true);
  expect(quietNow(prefs, new Date('2026-10-16T05:59:00Z'))).toBe(true);
  expect(quietNow(prefs, new Date('2026-10-16T06:00:00Z'))).toBe(false);
  expect(localClock(new Date('2026-10-25T22:59:00Z'), 'Europe/Berlin').day).toBe('2026-10-25');
  expect(localClock(new Date('2026-10-25T23:00:00Z'), 'Europe/Berlin').day).toBe('2026-10-26');
  expect(deliveryAllowed(prefs, [{ category: 'cooking' }], noon)).toBe(true);
  const recent = { ...prefs, last_sent_at: new Date(noon - 60000) };
  expect(deliveryAllowed(recent, [{ category: 'cooking' }], noon)).toBe(false);
  expect(deliveryAllowed(recent, [{ category: 'arrivals' }], noon)).toBe(true);
  expect(
    deliveryAllowed(
      { ...recent, budget_day: '2026-10-16', sent_today: 3, daily_limit: 99 },
      [{ category: 'arrivals' }],
      noon,
    ),
  ).toBe(false);
  expect(
    deliveryAllowed(
      { ...prefs, budget_day: '2026-10-15', sent_today: 3 },
      [{ category: 'cooking' }],
      noon,
    ),
  ).toBe(true);
  expect(deliveryAllowed({ ...prefs, enabled: false }, [{ category: 'arrivals' }], noon)).toBe(
    false,
  );
});
test('push delivery refuses arbitrary endpoints and notification links stay at the configured app origin', () => {
  for (const endpoint of [
    'https://127.0.0.1/private',
    'http://fcm.googleapis.com/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://fcm.googleapis.com:444/a',
    'https://user:password@fcm.googleapis.com/a',
  ])
    expect(allowedEndpoint(endpoint)).toBe(false);
  expect(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/test')).toBe(true);
  const event = { category: 'replies', organization_id: 'org', event_id: 'event', order_id: null };
  const message = pushMessage([event], 'de', 'https://lunch.example.test');
  expect(message.url).toBe('https://lunch.example.test/?pushOrg=org&pushEvent=event');
  expect(message.title).toContain('Antwort');
  expect(
    pushMessage([event, { ...event, event_id: 'other' }], 'en', 'https://lunch.example.test').url,
  ).toBe('https://lunch.example.test/');
});
test(
  'push database permissions, quiet/cap enforcement, deduplication, seen replies and revoked membership work end-to-end',
  { timeout: 30000 },
  async () => {
    const db = new PGlite();
    const query = async (sql, params) => {
      const result = params ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
      return { ...result, rowCount: result.rows?.length || result.affectedRows || 0 };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    const alice = '00000000-0000-0000-0000-000000000001',
      bob = '00000000-0000-0000-0000-000000000002';
    const login = async (id) =>
      db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
    const scalar = async (sql, params) => (await db.query(sql, params)).rows[0].value;
    const fakeDevice = 'https://fcm.googleapis.com/fcm/send/forkcast-test';
    const sent = [];
    const sender = async (subscription, payload) => {
      sent.push({ subscription, message: JSON.parse(payload) });
    };
    try {
      await db.exec(bootstrap);
      await migrate({ query }, resolve('supabase/migrations'), () => {});
      for (const [id, name] of [
        [alice, 'Alice'],
        [bob, 'Bob'],
      ])
        await db.query('insert into auth.users(id,raw_user_meta_data)values($1,$2)', [
          id,
          { display_name: name },
        ]);
      await login(alice);
      const org = await scalar("select public.create_organization('Push team','Berlin') as value");
      const code = await scalar('select public.organization_invite($1)as value', [org]);
      await login(bob);
      await db.query('select public.join_organization($1)', [code]);
      await expect(db.query('select * from public.web_push_subscriptions')).rejects.toThrow(
        'permission denied',
      );
      await expect(db.query('select * from forkcast_private.push_events')).rejects.toThrow(
        'permission denied',
      );
      await db.query('select public.register_web_push($1,$2,$3,$4,$5)', [
        fakeDevice,
        'B'.repeat(87),
        'A'.repeat(22),
        'de',
        'Europe/Berlin',
      ]);
      await expect(
        db.query('select public.register_web_push($1,$2,$3,$4,$5)', [
          'https://127.0.0.1/private',
          'B'.repeat(87),
          'A'.repeat(22),
          'de',
          'Europe/Berlin',
        ]),
      ).rejects.toThrow();
      for (const suffix of ['/two', '/three'])
        await db.query('select public.register_web_push($1,$2,$3,$4,$5)', [
          fakeDevice + suffix,
          'B'.repeat(87),
          'A'.repeat(22),
          'de',
          'Europe/Berlin',
        ]);
      await expect(
        db.query('select public.register_web_push($1,$2,$3,$4,$5)', [
          fakeDevice + '/four',
          'B'.repeat(87),
          'A'.repeat(22),
          'de',
          'Europe/Berlin',
        ]),
      ).rejects.toThrow('three devices');
      for (const suffix of ['/two', '/three'])
        await db.query('select public.unregister_web_push($1)', [fakeDevice + suffix]);
      const settings = await scalar('select public.web_push_settings()as value');
      expect(settings.preferences.payments).toBe(false);
      expect(settings.preferences.organizer).toBe(false);
      await db.query('select public.set_web_push_preferences($1)', [
        { ...settings.preferences, quiet_start: 0, quiet_end: 0 },
      ]);
      await login(alice);
      const meal = await scalar(
        "select public.create_cooking_event($1,public.lunch_day()+1,'Soup')as value",
        [org],
      );
      await db.exec('reset role');
      await db.query(
        "update forkcast_private.push_events set available_at=clock_timestamp()-interval '1 second'",
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(1);
      expect(sent.length).toBe(1);
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      await db.query(
        'update public.web_push_preferences set last_sent_at=null,sent_today=3,budget_day=(clock_timestamp()at time zone timezone)::date where user_id=$1',
        [bob],
      );
      await login(alice);
      await db.query("select public.create_cooking_event($1,public.lunch_day()+1,'Salad')", [org]);
      await db.exec('reset role');
      await db.exec(
        "update forkcast_private.push_events set available_at=clock_timestamp()-interval '1 second'where handled_at is null",
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      expect(sent.length).toBe(1);
      await db.query(
        'update public.web_push_preferences set sent_today=0,last_active_at=clock_timestamp()where user_id=$1',
        [bob],
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      await login(bob);
      await db.query("select public.save_cooking_comment($1,'Any nuts?')", [meal]);
      await login(alice);
      const reply = await scalar("select public.save_cooking_comment($1,'No nuts.')as value", [
        meal,
      ]);
      await login(bob);
      const inbox = await scalar('select public.notification_inbox($1)as value', [org]);
      expect(inbox.items.some((item) => item.kind === 'cooking_reply')).toBe(true);
      await db.query('select public.mark_cooking_comments_seen($1,$2)', [meal, reply]);
      expect(
        (await scalar('select public.notification_inbox($1)as value', [org])).items.find(
          (item) => item.kind === 'cooking_reply',
        ).read_at,
      ).not.toBeNull();
      await db.exec('reset role');
      await db.query(
        'update public.web_push_preferences set last_active_at=null,last_sent_at=null,sent_today=0 where user_id=$1',
        [bob],
      );
      await login(alice);
      await db.query(
        "select public.set_cooking_signup_deadline($1,clock_timestamp()+interval '15 minutes',false)",
        [meal],
      );
      await db.exec('reset role');
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(1);
      expect(sent.length).toBe(2);
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      await login(alice);
      const paidMeal = await scalar(
        "select public.create_cooking_event($1,public.lunch_day()+1,'Paid soup',null,null,500,'Cook')as value",
        [org],
      );
      await login(bob);
      await db.query('select public.set_portions($1,1)', [paidMeal]);
      await db.exec('reset role');
      await db.query(
        "update public.notifications set created_at=clock_timestamp()-interval '2 days' where event_id=$1 and kind='payment_due'",
        [paidMeal],
      );
      await db.query(
        "update public.web_push_preferences set cooking=false,deadlines=false,replies=false,payments=true,last_active_at=null,last_sent_at=null,sent_today=0,last_payment_at=clock_timestamp()-interval '2 days' where user_id=$1",
        [bob],
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      await db.query(
        "update public.web_push_preferences set last_payment_at=clock_timestamp()-interval '4 days' where user_id=$1",
        [bob],
      );
      await runCycle(pool, sender, 'https://lunch.example.test');
      await db.exec(
        "update forkcast_private.push_events set available_at=clock_timestamp()-interval '1 second'where handled_at is null",
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(1);
      expect(sent.length).toBe(3);
      await db.query(
        'update public.web_push_preferences set last_sent_at=null,sent_today=0 where user_id=$1',
        [bob],
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      await login(bob);
      await db.query('select public.leave_organization($1)', [org]);
      await db.exec('reset role');
      await db.query(
        'update public.web_push_preferences set last_active_at=null,last_sent_at=null,sent_today=0 where user_id=$1',
        [bob],
      );
      await db.exec(
        "update forkcast_private.push_events set available_at=clock_timestamp()-interval '1 second'where handled_at is null",
      );
      expect(await runCycle(pool, sender, 'https://lunch.example.test')).toBe(0);
      expect(sent.length).toBe(3);
    } finally {
      await db.close();
    }
  },
);
