import { Client, Pool, type PoolClient } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { bootstrap } from './bootstrap';

const connection = process.env.FORKCAST_TEST_DATABASE_URL;
const integration = test.skipIf(!connection);
let pool: Pool;
let org: string;
const users = Array.from({ length: 12 }, () => randomUUID());
beforeAll(async () => {
  if (!connection) return;
  const url = new URL(connection);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/postgres')
    throw new Error('Use an isolated loopback test server with the /postgres database.');
  const admin = new Client({ connectionString: connection });
  await admin.connect();
  // Deliberately fail if this database already exists; never reset an existing DB.
  await admin.query('create database forkcast_test');
  await admin.end();
  url.pathname = '/forkcast_test';
  pool = new Pool({ connectionString: url.toString(), max: 16 });
  await pool.query(bootstrap);
  for (const file of readdirSync(resolve('supabase/migrations')).sort())
    await pool.query(readFileSync(resolve('supabase/migrations', file), 'utf8'));
  for (const id of users) await pool.query('insert into auth.users(id) values($1)', [id]);
  await pool.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', users[0]]);
  org = (await pool.query("select public.create_organization('Race test','Berlin') as id")).rows[0]
    .id;
  for (const user of users.slice(1))
    await pool.query(
      'insert into public.organization_memberships(organization_id,user_id) values($1,$2)',
      [org, user],
    );
}, 30000);
afterAll(async () => {
  if (pool) await pool.end();
});
async function begin(client: PoolClient, user: string) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', user]);
}

integration(
  'a competing signup waits for the event lock and then checks committed capacity',
  async () => {
    const event = (
      await pool.query(
        "insert into public.cooking_events(organization_id,organizer_id,meal_date,title,max_portions) values($1,$2,current_date+1,'Curry',3) returning id",
        [org, users[0]],
      )
    ).rows[0].id;
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      await begin(first, users[0]);
      await begin(second, users[1]);
      await first.query('select public.set_portions($1,2)', [event]);
      const waiting = second.query('select public.set_portions($1,2)', [event]).then(
        () => null,
        (error) => error,
      );
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const state = (
          await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])
        ).rows[0];
        if (state?.wait_event_type === 'Lock') {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await first.query('commit');
      expect((await waiting)?.message).toContain('Not enough portions');
      await second.query('rollback');
      expect(
        Number(
          (
            await pool.query(
              'select sum(portions) as total from public.cooking_event_participants where event_id=$1',
              [event],
            )
          ).rows[0].total,
        ),
      ).toBe(2);
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);

integration(
  'twelve concurrent signups cannot exceed three portions',
  async () => {
    const event = (
      await pool.query(
        "insert into public.cooking_events(organization_id,organizer_id,meal_date,title,max_portions) values($1,$2,current_date+1,'Pasta',3) returning id",
        [org, users[0]],
      )
    ).rows[0].id;
    const results = await Promise.allSettled(
      users.map(async (user) => {
        const client = await pool.connect();
        try {
          await begin(client, user);
          await client.query('select public.set_portions($1,1)', [event]);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        } finally {
          client.release();
        }
      }),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(9);
    expect(
      Number(
        (
          await pool.query(
            'select sum(portions) as total from public.cooking_event_participants where event_id=$1',
            [event],
          )
        ).rows[0].total,
      ),
    ).toBe(3);
  },
  15000,
);

integration('only one concurrent regional refresh receives the lease', async () => {
  const results = await Promise.all(
    users.map(async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('set local role service_role');
        const result = await client.query('select public.claim_osm_refresh($1,$2) as token', [
          org,
          'Berlin',
        ]);
        await client.query('commit');
        return result.rows[0].token;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
});

integration('the global OSM gate serializes concurrent requests', async () => {
  const results = await Promise.all(
    users.map(async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('set local role service_role');
        const result = await client.query(
          "select public.claim_osm_request('nominatim') as allowed",
        );
        await client.query('commit');
        return result.rows[0].allowed;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
});

integration('OSM request reservations use the time after a row-lock wait', async () => {
  await pool.query(
    "insert into public.osm_request_gate(service,available_at) values('nominatim',now()-interval '1 second') on conflict(service) do update set available_at=excluded.available_at",
  );
  const holder = await pool.connect();
  const request = await pool.connect();
  try {
    await holder.query('begin');
    await holder.query(
      "select * from public.osm_request_gate where service='nominatim' for update",
    );
    await request.query('begin');
    await request.query('set local role service_role');
    const waiting = request.query("select public.claim_osm_request('nominatim') as allowed");
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await holder.query('commit');
    expect((await waiting).rows[0].allowed).toBe(true);
    await request.query('commit');
    expect(
      (await pool.query("select public.claim_osm_request('nominatim') as allowed")).rows[0].allowed,
    ).toBe(false);
  } finally {
    await holder.query('rollback');
    await request.query('rollback');
    holder.release();
    request.release();
  }
});

integration(
  'daily response and vote races serialize and never retain a vote after opting out',
  async () => {
    const place = {
      id: 'osm:node:555',
      provider: 'osm',
      name: 'Race cafe',
      latitude: 52.52,
      longitude: 13.4,
      types: ['cafe'],
      category: 'Cafe',
      address: 'Berlin',
      hours: [],
    };
    await pool.query("insert into public.places(id,provider,metadata) values($1,'osm',$2)", [
      place.id,
      place,
    ]);
    await pool.query(
      'insert into public.daily_lunch_options(organization_id,lunch_date,place_id) values($1,public.lunch_day(),$2)',
      [org, place.id],
    );
    const first = await pool.connect(),
      second = await pool.connect();
    async function blocked(pid: number) {
      for (let i = 0; i < 100; i++) {
        const state = (
          await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])
        ).rows[0];
        if (state?.wait_event_type === 'Lock') return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    }
    try {
      await begin(first, users[0]);
      await first.query("select public.set_lunch_response($1,'going_out')", [org]);
      await first.query('commit');
      await begin(first, users[0]);
      await first.query("select public.set_lunch_response($1,'no_lunch')", [org]);
      await begin(second, users[0]);
      const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      const vote = second.query('select public.vote_lunch_place($1,$2)', [org, place.id]).then(
        () => null,
        (error) => error,
      );
      expect(await blocked(pid)).toBe(true);
      await first.query('commit');
      expect((await vote)?.message).toContain('going out');
      await second.query('rollback');
      await begin(first, users[0]);
      await first.query("select public.set_lunch_response($1,'going_out')", [org]);
      await first.query('select public.vote_lunch_place($1,$2)', [org, place.id]);
      await begin(second, users[0]);
      const answer = second
        .query("select public.set_lunch_response($1,'brought_food')", [org])
        .then(
          () => null,
          (error) => error,
        );
      expect(await blocked(pid)).toBe(true);
      await first.query('commit');
      expect(await answer).toBe(null);
      await second.query('commit');
      expect(
        Number(
          (
            await pool.query(
              'select count(*) as count from public.daily_lunch_votes where organization_id=$1 and user_id=$2 and lunch_date=public.lunch_day()',
              [org, users[0]],
            )
          ).rows[0].count,
        ),
      ).toBe(0);
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);

integration(
  'simultaneous saved-place refreshes share one lease and enforce the manual cooldown',
  async () => {
    const id = 'osm:node:987654';
    const metadata = {
      id,
      provider: 'osm',
      name: 'Refresh race',
      types: ['restaurant', 'cuisine:unknown'],
    };
    await pool.query("insert into public.places(id,provider,metadata) values($1,'osm',$2)", [
      id,
      metadata,
    ]);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.query('select * from public.claim_osm_place_refresh($1,false)', [[id]]),
      ),
    );
    const leases = results.flatMap((result) => result.rows);
    expect(leases).toHaveLength(1);
    await pool.query('select public.finish_osm_place_refresh($1,$2,true)', [
      leases[0].token,
      JSON.stringify([metadata]),
    ]);
    expect(
      (await pool.query('select * from public.claim_osm_place_refresh($1,true)', [[id]])).rows,
    ).toHaveLength(0);
  },
);

integration(
  'reading one notification does not block payment updates for another notification',
  async () => {
    const owner = users[0],
      colleague = users[1];
    await pool.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', owner]);
    const meal = (
      await pool.query(
        "select public.create_cooking_event($1,public.lunch_day(),'Signal concurrency',null,3,100,'TestCook') as id",
        [org],
      )
    ).rows[0].id;
    await pool.query('select public.set_portions($1,1)', [meal]);
    await pool.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', colleague]);
    await pool.query('select public.set_portions($1,1)', [meal]);
    await pool.query('select public.mark_payment($1,true)', [meal]);
    const own = (
      await pool.query(
        "select id from public.notifications where event_id=$1 and recipient_id=$2 and kind='payment_due'",
        [meal, owner],
      )
    ).rows[0].id;
    const first = await pool.connect(),
      second = await pool.connect();
    let payment: Promise<unknown> | undefined;
    try {
      await begin(first, owner);
      await first.query('select public.update_notification($1,$2,false)', [org, own]);
      await begin(second, colleague);
      payment = second.query('select public.mark_payment($1,false)', [meal]);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const completed = await Promise.race([
        payment.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1500);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      expect(completed).toBe(true);
      await second.query('commit');
      await first.query('commit');
    } finally {
      await first.query('rollback');
      await payment?.catch(() => {});
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
);

integration(
  'a manual answer racing cooking signup waits and remains manual after leaving',
  async () => {
    const user = users[9];
    const meal = (
      await pool.query(
        "insert into public.cooking_events(organization_id,organizer_id,meal_date,title) values($1,$2,public.lunch_day(),'Attendance race') returning id",
        [org, users[0]],
      )
    ).rows[0].id;
    const first = await pool.connect();
    const second = await pool.connect();
    let update: Promise<unknown> | undefined;
    try {
      await begin(first, user);
      await first.query('select public.set_portions($1,1)', [meal]);
      await begin(second, user);
      let completed = false;
      update = second
        .query("select public.set_lunch_response($1,'ordering_in')", [org])
        .then((result) => {
          completed = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(completed).toBe(false);
      await first.query('commit');
      await update;
      await second.query('commit');
      await begin(first, user);
      await first.query('select public.set_portions($1,0)', [meal]);
      await first.query('commit');
      const answer = (
        await pool.query(
          'select choice,from_cooking from public.daily_lunch_responses where organization_id=$1 and lunch_date=public.lunch_day() and user_id=$2',
          [org, user],
        )
      ).rows[0];
      expect(answer).toMatchObject({ choice: 'ordering_in', from_cooking: false });
    } finally {
      await first.query('rollback');
      await update?.catch(() => {});
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
);

integration.each(['event', 'organization'] as const)(
  'a signup queued on the %s lock is rejected when the deadline passes before it can write',
  async (lock) => {
    const event = (
      await pool.query(
        "insert into public.cooking_events(organization_id,organizer_id,meal_date,title,signup_deadline) values($1,$2,current_date+1,'Deadline race',clock_timestamp()+interval '2 seconds') returning id",
        [org, users[0]],
      )
    ).rows[0].id;
    const holder = await pool.connect();
    const waiter = await pool.connect();
    try {
      const pid = (await waiter.query('select pg_backend_pid() as pid')).rows[0].pid;
      await holder.query('begin');
      await holder.query(
        lock === 'event'
          ? 'select id from public.cooking_events where id=$1 for update'
          : 'select id from public.organizations where id=$1 for update',
        [lock === 'event' ? event : org],
      );
      await begin(waiter, users[1]);
      const waiting = waiter.query('select public.set_portions($1,1)', [event]).then(
        () => null,
        (error) => error,
      );
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const state = (
          await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])
        ).rows[0];
        if (state?.wait_event_type === 'Lock') {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await pool.query(
        'select pg_sleep(greatest(0,extract(epoch from signup_deadline-clock_timestamp()))+0.05) from public.cooking_events where id=$1',
        [event],
      );
      await holder.query('commit');
      expect((await waiting)?.message).toContain('Signup is closed');
      await waiter.query('rollback');
      expect(
        Number(
          (
            await pool.query(
              'select count(*) as total from public.cooking_event_participants where event_id=$1',
              [event],
            )
          ).rows[0].total,
        ),
      ).toBe(0);
    } finally {
      await holder.query('rollback');
      await waiter.query('rollback');
      holder.release();
      waiter.release();
    }
  },
  15000,
);

integration.each(['portion-first', 'confirmation-first'] as const)(
  'payment confirmation and portion changes serialize correctly (%s)',
  async (order) => {
    const event = (
      await pool.query(
        "insert into public.cooking_events(organization_id,organizer_id,meal_date,title,price_cents,paypal_handle) values($1,$2,current_date+1,'Payment race',425,'TestOnly') returning id",
        [org, users[0]],
      )
    ).rows[0].id;
    await pool.query(
      'insert into public.cooking_event_participants(event_id,user_id,portions) values($1,$2,2)',
      [event, users[1]],
    );
    const holder = await pool.connect();
    const waiter = await pool.connect();
    try {
      const pid = (await waiter.query('select pg_backend_pid() as pid')).rows[0].pid;
      await begin(holder, order === 'portion-first' ? users[1] : users[0]);
      await begin(waiter, order === 'portion-first' ? users[0] : users[1]);
      if (order === 'portion-first')
        await holder.query('select public.set_portions($1,3)', [event]);
      else await holder.query('select public.confirm_cooking_payment($1,$2,2)', [event, users[1]]);
      const waiting = (
        order === 'portion-first'
          ? waiter.query('select public.confirm_cooking_payment($1,$2,2)', [event, users[1]])
          : waiter.query('select public.set_portions($1,3)', [event])
      ).then(
        () => null,
        (error) => error,
      );
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        if (
          (await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]))
            .rows[0]?.wait_event_type === 'Lock'
        ) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await holder.query('commit');
      const error = await waiting;
      if (order === 'portion-first') {
        expect(error?.message).toContain('Portions changed');
        await waiter.query('rollback');
      } else {
        expect(error).toBeNull();
        await waiter.query('commit');
      }
      expect(
        (
          await pool.query(
            'select portions,paid,payment_confirmed_at from public.cooking_event_participants where event_id=$1 and user_id=$2',
            [event, users[1]],
          )
        ).rows[0],
      ).toEqual({ portions: 3, paid: false, payment_confirmed_at: null });
      expect(
        Number(
          (
            await pool.query(
              "select count(*) as total from public.notifications where event_id=$1 and kind='payment_confirmed'",
              [event],
            )
          ).rows[0].total,
        ),
      ).toBe(0);
    } finally {
      await holder.query('rollback');
      await waiter.query('rollback');
      holder.release();
      waiter.release();
    }
  },
  15000,
);

integration(
  'concurrent administrator demotions retain one administrator and recheck waiting permissions',
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    await begin(first, users[0]);
    const group = (
      await first.query("select public.create_organization('Admin race','Berlin') as id")
    ).rows[0].id;
    await first.query('commit');
    await pool.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'admin')",
      [group, users[1]],
    );
    async function waitForLock(pid: number) {
      for (let i = 0; i < 100; i++) {
        if (
          (await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]))
            .rows[0]?.wait_event_type === 'Lock'
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Competing administrator mutation did not wait for the organization lock');
    }
    try {
      const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      await begin(first, users[0]);
      await begin(second, users[1]);
      await first.query("select public.set_organization_member_role($1,$2,'member')", [
        group,
        users[0],
      ]);
      const pending = second
        .query("select public.set_organization_member_role($1,$2,'member')", [group, users[1]])
        .then(
          () => null,
          (e) => e,
        );
      await waitForLock(pid);
      await first.query('commit');
      expect((await pending)?.message).toContain('at least one');
      await second.query('rollback');
      expect(
        Number(
          (
            await pool.query(
              "select count(*) as count from public.organization_memberships where organization_id=$1 and role='admin'",
              [group],
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      // Restore two admins; revoke the waiting administrator before its invite request runs.
      await begin(first, users[1]);
      await first.query("select public.set_organization_member_role($1,$2,'admin')", [
        group,
        users[0],
      ]);
      await first.query('commit');
      await begin(first, users[0]);
      await first.query("select public.set_organization_member_role($1,$2,'member')", [
        group,
        users[1],
      ]);
      await begin(second, users[1]);
      const invite = second.query('select public.organization_invite($1,true)', [group]).then(
        () => null,
        (e) => e,
      );
      await waitForLock(pid);
      await first.query('commit');
      expect((await invite)?.message).toContain('Only organization administrators');
      await second.query('rollback');
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);

integration(
  'concurrent administrator departures preserve one administrator',
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await begin(first, users[0]);
      const group = (
        await first.query("select public.create_organization('Leave race','Berlin') as id")
      ).rows[0].id;
      await first.query('commit');
      await pool.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'admin')",
        [group, users[1]],
      );
      await begin(first, users[0]);
      await first.query('select public.leave_organization($1)', [group]);
      await begin(second, users[1]);
      const waiting = second.query('select public.leave_organization($1)', [group]).then(
        () => null,
        (e) => e,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await first.query('commit');
      expect((await waiting)?.message).toContain('at least one');
      await second.query('rollback');
      expect(
        (
          await pool.query(
            "select * from public.organization_memberships where organization_id=$1 and role='admin'",
            [group],
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);

integration(
  'removal invalidates queued invitations, attendance edits and cooking signups',
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await begin(first, users[0]);
      const group = (
        await first.query("select public.create_organization('Removal race','Berlin') as id")
      ).rows[0].id;
      const meal = (
        await first.query(
          "select public.create_cooking_event($1,public.lunch_day(),'Race meal',null,5) as id",
          [group],
        )
      ).rows[0].id;
      await first.query('commit');
      const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      for (const action of ['invite', 'attendance', 'cooking']) {
        await pool.query(
          'insert into public.organization_memberships(organization_id,user_id) values($1,$2)',
          [group, users[1]],
        );
        const code = (
          await pool.query(
            'select code from public.organization_invites where organization_id=$1',
            [group],
          )
        ).rows[0].code;
        await begin(first, users[0]);
        await first.query('select public.remove_organization_member($1,$2)', [group, users[1]]);
        await begin(second, users[1]);
        const queued = (
          action === 'invite'
            ? second.query('select public.join_organization($1)', [code])
            : action === 'attendance'
              ? second.query("select public.set_lunch_response($1,'going_out')", [group])
              : second.query('select public.set_portions($1,1)', [meal])
        ).then(
          () => null,
          (e) => e,
        );
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if (
            (await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]))
              .rows[0]?.wait_event_type === 'Lock'
          ) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await first.query('commit');
        expect((await queued)?.message).toContain(
          action === 'invite' ? 'invalid' : 'access denied',
        );
        await second.query('rollback');
      }
      expect(
        (
          await pool.query(
            'select * from public.cooking_event_participants where event_id=$1 and user_id=$2',
            [meal, users[1]],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool.query(
            'select * from public.daily_lunch_responses where organization_id=$1 and user_id=$2',
            [group, users[1]],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);

integration(
  'office order saves serialize per participant and stale checkout cannot freeze an outdated bill',
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await begin(first, users[0]);
      const order = (
        await first.query(
          "select public.create_office_order($1,public.lunch_day()+1,'Pizza','https://example.invalid/menu',clock_timestamp()+interval '1 hour','Office') as id",
          [org],
        )
      ).rows[0].id;
      await first.query('commit');
      const items = [{ item_name: 'Pizza', quantity: 1, unit_cents: 800 }];
      await begin(first, users[1]);
      await first.query('select public.save_office_order_items($1,$2,true,0)', [
        order,
        JSON.stringify(items),
      ]);
      await begin(second, users[1]);
      const saving = second
        .query('select public.save_office_order_items($1,$2,true,0)', [
          order,
          JSON.stringify(items),
        ])
        .then(
          () => null,
          (e) => e,
        );

      await first.query('commit');
      expect((await saving)?.message).toContain('Your order changed');
      await second.query('rollback');
      expect(
        (await pool.query('select * from public.office_order_items where order_id=$1', [order]))
          .rows,
      ).toHaveLength(1);
      await begin(first, users[0]);
      const version = (
        await first.query('select version from public.office_orders where id=$1', [order])
      ).rows[0].version;
      await first.query("select public.update_office_order($1,$2,'closed')", [order, version]);
      await first.query('commit');
      await begin(first, users[0]);
      await expect(
        first.query("select public.update_office_order($1,$2,'placed',0)", [order, version]),
      ).rejects.toThrow('order changed');
      await first.query('rollback');
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);

integration(
  'queued office order signups recheck the real deadline and membership after both locks',
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await begin(first, users[0]);
      const order = (
        await first.query(
          "select public.create_office_order($1,public.lunch_day()+1,'Curry','https://example.invalid/menu',clock_timestamp()+interval '1 hour','Office') as id",
          [org],
        )
      ).rows[0].id;
      await first.query('commit');
      const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      for (const revoked of [false, true]) {
        await begin(first, users[0]);
        if (revoked) {
          await first.query('select public.remove_organization_member($1,$2)', [org, users[2]]);
        } else
          await first.query(
            "select public.update_office_order($1,1,'open',0,null,clock_timestamp()+interval '150 milliseconds')",
            [order],
          );
        await begin(second, users[2]);
        const saving = second
          .query('select public.save_office_order_items($1,$2,true,0)', [
            order,
            JSON.stringify([{ item_name: 'Curry', quantity: 1, unit_cents: 900 }]),
          ])
          .then(
            () => null,
            (e) => e,
          );
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          if (
            (await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]))
              .rows[0]?.wait_event_type === 'Lock'
          ) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        if (!revoked) await new Promise((resolve) => setTimeout(resolve, 200));
        await first.query('commit');
        expect((await saving)?.message).toContain(revoked ? 'access denied' : 'closed for changes');
        await second.query('rollback');
      }
      expect(
        (await pool.query('select * from public.office_order_items where order_id=$1', [order]))
          .rows,
      ).toHaveLength(0);
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      first.release();
      second.release();
    }
  },
  15000,
);
