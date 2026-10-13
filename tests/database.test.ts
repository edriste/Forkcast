import { bootstrap } from './bootstrap';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';

const db = new PGlite();
const alice = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const outsider = '00000000-0000-0000-0000-000000000003';
let org: string;
let otherOrg: string;
let invite: string;
let event: string;
async function login(id: string) {
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${id}';`);
}
async function scalar<T>(query: string, params?: unknown[]): Promise<T> {
  return (await db.query<Record<string, T>>(query, params)).rows[0].value;
}
beforeAll(async () => {
  await db.exec(bootstrap);
  const directory = resolve('supabase/migrations');
  for (const file of readdirSync(directory)
    .sort()
    .filter((file) => file < '202610120010'))
    await db.exec(readFileSync(resolve(directory, file), 'utf8'));
  for (const [id, name] of [
    [alice, 'Alice'],
    [bob, 'Bob'],
    [outsider, 'Outsider'],
  ])
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
      id,
      { display_name: name },
    ]);
  await login(alice);
  org = await scalar<string>("select public.create_organization('Team','Berlin') as value");
  invite = await scalar<string>('select public.organization_invite($1) as value', [org]);
  await login(outsider);
  otherOrg = await scalar<string>("select public.create_organization('Other','Hamburg') as value");
  await db.query("select public.add_review($1,'old-google-place',2,'neutral','Keep my visit')", [
    otherOrg,
  ]);
  await login(alice);
  await db.query("select public.add_review($1,'old-google-place',5,'recommend','Original visit')", [
    org,
  ]);
  await db.exec('reset role');
  await db.exec(readFileSync(resolve(directory, '202610120010_osm.sql'), 'utf8'));
  const place = {
    id: 'osm:node:1',
    provider: 'osm',
    name: 'Miso Kitchen',
    latitude: 52.52,
    longitude: 13.4,
    types: ['cuisine:japanese'],
    hours: [],
    category: 'Restaurant · Japanese',
    address: 'Berlin',
  };
  await db.query("insert into public.places(id,provider,metadata) values($1,'osm',$2)", [
    place.id,
    place,
  ]);
  for (const group of [org, otherOrg])
    await db.query(
      'insert into public.osm_region_cache(organization_id,area_query,places,refreshed_at) values($1,$2,$3,now())',
      [group, 'Berlin', [place]],
    );
  await db.query(
    'update public.osm_region_cache set area_query=$1,latitude=52.52,longitude=13.4 where organization_id=$2',
    ['Berlin', org],
  );
  for (const file of readdirSync(directory)
    .sort()
    .filter((file) => file >= '202610120011')) {
    if (file === '202610130022_editable_reviews.sql') {
      await db.query(
        "insert into public.places(id,provider) values('historical-opinions','google_legacy')",
      );
      await db.query(
        "insert into public.reviews(organization_id,place_id,author_id,stars,recommendation,comment,created_at) values($1,'historical-opinions',$2,5,'recommend','Old opinion','2025-01-01'),($1,'historical-opinions',$2,2,'avoid','Latest opinion','2025-02-01')",
        [org, alice],
      );
    }
    if (file === '202610130024_lunch_ordering.sql') {
      await db.query(
        "insert into public.daily_lunch_responses values($1,public.lunch_day()-20,$2,'not_in_office'),($1,public.lunch_day()-20,$3,'no_lunch')",
        [org, alice, bob],
      );
    }
    if (file === '202610130025_daily_shortlist.sql') {
      await db.query(
        "insert into public.daily_lunch_options(organization_id,lunch_date,place_id) values($1,public.lunch_day(),'osm:node:1')",
        [org],
      );
    }
    await db.exec(readFileSync(resolve(directory, file), 'utf8'));
  }
}, 30000);
afterAll(async () => {
  await db.close();
});

test('organizations, memberships and profiles are isolated', async () => {
  await login(bob);
  expect((await db.query('select * from public.organizations')).rows).toHaveLength(0);
  expect((await db.query('select * from public.organization_memberships')).rows).toHaveLength(0);
  expect((await db.query('select * from public.profiles')).rows).toHaveLength(1);
  await expect(db.query('select * from public.organization_invites')).rejects.toThrow();
  await expect(db.query('select public.organization_invite($1)', [org])).rejects.toThrow(
    'Only the group creator',
  );
  expect(await scalar('select public.join_organization($1) as value', [invite])).toBe(org);
  expect((await db.query('select * from public.organizations')).rows).toHaveLength(1);
  expect((await db.query('select * from public.profiles')).rows).toHaveLength(2);
  await db.query('select public.join_organization($1)', [invite]);
  expect((await db.query('select * from public.organization_memberships')).rows).toHaveLength(2);
  await expect(
    db.query('insert into public.organization_memberships(organization_id,user_id) values($1,$2)', [
      otherOrg,
      bob,
    ]),
  ).rejects.toThrow();
});

test('existing groups reuse a known cached center during migration', async () => {
  await login(alice);
  const result = (
    await db.query(
      'select latitude,longitude,location_label from public.organizations where id=$1',
      [org],
    )
  ).rows[0];
  expect(result).toEqual({ latitude: 52.52, longitude: 13.4, location_label: 'Berlin' });
});

test('Google account creation uses profile names and grants no group membership', async () => {
  await db.exec('reset role');
  const id = '00000000-0000-0000-0000-000000000004';
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
    id,
    { full_name: '  Google Colleague  ', name: 'Other name' },
  ]);
  await login(id);
  expect(await scalar('select display_name as value from public.profiles where id=$1', [id])).toBe(
    'Google Colleague',
  );
  expect((await db.query('select * from public.organization_memberships')).rows).toHaveLength(0);
});

test('invite rotation invalidates the earlier code', async () => {
  await login(alice);
  const next = await scalar<string>('select public.organization_invite($1,true) as value', [org]);
  expect(next).not.toBe(invite);
  await login(outsider);
  await expect(db.query('select public.join_organization($1)', [invite])).rejects.toThrow(
    'invalid',
  );
});

test('review migration preserves existing repeat visits and counts only the newest opinion', async () => {
  await login(alice);
  expect(
    (await db.query("select * from public.reviews where place_id='historical-opinions'")).rows,
  ).toHaveLength(2);
  const current = (
    await db.query("select * from public.current_reviews where place_id='historical-opinions'")
  ).rows;
  expect(current).toHaveLength(1);
  expect(current[0]).toMatchObject({ stars: 2, comment: 'Latest opinion' });
  expect(
    (await db.query("select * from public.place_ratings where place_id='historical-opinions'"))
      .rows[0],
  ).toMatchObject({ count: 1, average: '2.00' });
});

test('review edits preserve history but count each author once within their organization', async () => {
  await login(alice);
  await db.query("select public.add_review($1,'osm:node:1',5,'recommend','Great lunch')", [org]);
  await db.query("select public.add_review($1,'osm:node:1',3,'neutral','Second visit')", [org]);
  const current = (
    await db.query<{ id: string; author_id: string; stars: number; comment: string }>(
      "select * from public.current_reviews where organization_id=$1 and place_id='osm:node:1'",
      [org],
    )
  ).rows;
  expect(current).toHaveLength(1);
  expect(current[0]).toMatchObject({ author_id: alice, stars: 3, comment: 'Second visit' });
  const unchanged = await scalar<string>(
    "select public.add_review($1,'osm:node:1',3,'neutral','Second visit') as value",
    [org],
  );
  expect(unchanged).toBe(current[0].id);
  await expect(
    db.query('update public.reviews set stars=1 where author_id=$1', [alice]),
  ).rejects.toThrow();
  await login(bob);
  await db.query("select public.add_review($1,'osm:node:1',4,'avoid',null)", [org]);
  const rating = (
    await db.query<{
      average: string;
      count: number;
    }>("select * from public.place_ratings where place_id='osm:node:1'")
  ).rows[0];
  expect(Number(rating.average)).toBe(3.5);
  expect(rating).toMatchObject({ count: 2 });
  await expect(
    db.query("select public.add_review($1,'osm:node:1',6,'recommend',null)", [org]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.add_review($1,'osm:node:1',4,'other',null)", [org]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.add_review($1,'osm:node:1',4,'recommend',null)", [otherOrg]),
  ).rejects.toThrow('access denied');
  await login(outsider);
  expect(
    (await db.query("select * from public.reviews where place_id='osm:node:1'")).rows,
  ).toHaveLength(0);
  expect((await db.query("select * from public.places where id='osm:node:1'")).rows).toHaveLength(
    0,
  );
  expect(
    (await db.query("select * from public.place_ratings where place_id='osm:node:1'")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select * from public.current_reviews where place_id='osm:node:1'")).rows,
  ).toHaveLength(0);
  await db.query("select public.add_review($1,'osm:node:1',1,'avoid',null)", [otherOrg]);
  const ownRating = (
    await db.query<{ average: string; count: number }>(
      "select * from public.place_ratings where place_id='osm:node:1'",
    )
  ).rows[0];
  expect(Number(ownRating.average)).toBe(1);
  expect(ownRating.count).toBe(1);
  await login(alice);
  expect(
    (await db.query("select * from public.reviews where place_id='osm:node:1'")).rows,
  ).toHaveLength(3);
});

test('portion capacity, changes and leaving are atomic and member-only', async () => {
  await login(alice);
  event = await scalar<string>(
    "select public.create_cooking_event($1, (now() at time zone 'Europe/Berlin')::date, 'Curry', null, 3) as value",
    [org],
  );
  await db.query('select public.set_portions($1,2)', [event]);
  await login(bob);
  await expect(db.query('select public.set_portions($1,2)', [event])).rejects.toThrow(
    'Not enough portions',
  );
  expect((await db.query('select * from public.cooking_event_participants')).rows).toHaveLength(1);
  await db.query('select public.set_portions($1,1)', [event]);
  await expect(db.query('select public.set_portions($1,-1)', [event])).rejects.toThrow();
  await login(alice);
  await expect(db.query('select public.set_portions($1,3)', [event])).rejects.toThrow(
    'Not enough portions',
  );
  await db.query('select public.set_portions($1,1)', [event]);
  await login(bob);
  await db.query('select public.set_portions($1,2)', [event]);
  expect(
    Number(
      await scalar(
        'select sum(portions) as value from public.cooking_event_participants where event_id=$1',
        [event],
      ),
    ),
  ).toBe(3);
  await db.query('select public.set_portions($1,0)', [event]);
  expect(
    Number(
      await scalar(
        'select sum(portions) as value from public.cooking_event_participants where event_id=$1',
        [event],
      ),
    ),
  ).toBe(1);
  await expect(
    db.query(
      'insert into public.cooking_event_participants(event_id,user_id,portions) values($1,$2,9)',
      [event, bob],
    ),
  ).rejects.toThrow();
  await login(outsider);
  expect((await db.query('select * from public.cooking_events')).rows).toHaveLength(0);
  expect((await db.query('select * from public.cooking_event_participants')).rows).toHaveLength(0);
  await expect(db.query('select public.set_portions($1,1)', [event])).rejects.toThrow(
    'access denied',
  );
  await expect(
    db.query("select public.create_cooking_event($1,current_date,'Unauthorized')", [org]),
  ).rejects.toThrow('access denied');
});

test('unlimited lunches and closed past lunches', async () => {
  await login(alice);
  const unlimited = await scalar<string>(
    "select public.create_cooking_event($1, (now() at time zone 'Europe/Berlin')::date) as value",
    [org],
  );
  await db.query('select public.set_portions($1,10000)', [unlimited]);
  await login(bob);
  await db.query('select public.set_portions($1,10000)', [unlimited]);
  expect(
    Number(
      await scalar(
        'select sum(portions) as value from public.cooking_event_participants where event_id=$1',
        [unlimited],
      ),
    ),
  ).toBe(20000);
  await db.exec('reset role');
  await db.query(
    "update public.cooking_events set meal_date = (now() at time zone 'Europe/Berlin')::date - 1 where id=$1",
    [unlimited],
  );
  await login(bob);
  await expect(db.query('select public.set_portions($1,1)', [unlimited])).rejects.toThrow(
    'already passed',
  );
});

test('receipt records and storage paths are restricted to group members and organizer uploads', async () => {
  const path = `${event}/10000000-0000-0000-0000-000000000001.jpg`;
  await login(alice);
  await db.query("insert into storage.objects(bucket_id,name) values('lunch-images',$1)", [path]);
  await db.query(
    "insert into public.event_images(event_id,kind,storage_path,uploaded_by) values($1,'receipt',$2,$3)",
    [event, path, alice],
  );
  expect((await db.query('select * from public.event_images')).rows).toHaveLength(1);
  await login(bob);
  expect((await db.query('select * from public.event_images')).rows).toHaveLength(1);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
  await expect(
    db.query("insert into storage.objects(bucket_id,name) values('lunch-images',$1)", [
      `${event}/10000000-0000-0000-0000-000000000002.jpg`,
    ]),
  ).rejects.toThrow();
  await expect(
    db.query(
      "insert into public.event_images(event_id,kind,storage_path,uploaded_by) values($1,'receipt',$2,$3)",
      [event, `${event}/10000000-0000-0000-0000-000000000002.jpg`, bob],
    ),
  ).rejects.toThrow();
  await login(outsider);
  expect((await db.query('select * from public.event_images')).rows).toHaveLength(0);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  expect(await scalar('select public.can_access_event_image($1) as value', [path])).toBe(false);
  expect(await scalar("select public.can_access_event_image('not-a-uuid/file.jpg') as value")).toBe(
    false,
  );
});

test('payments can be self-reported only by a participant and quantity changes reset status', async () => {
  await login(alice);
  await db.query('select public.mark_payment($1,true)', [event]);
  expect(
    await scalar(
      'select paid as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [event, alice],
    ),
  ).toBe(true);
  await db.query('select public.set_portions($1,1)', [event]);
  expect(
    await scalar(
      'select paid as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [event, alice],
    ),
  ).toBe(true);
  await db.query('select public.set_portions($1,2)', [event]);
  expect(
    await scalar(
      'select paid as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [event, alice],
    ),
  ).toBe(false);
  await login(bob);
  await expect(db.query('select public.mark_payment($1,true)', [event])).rejects.toThrow(
    'Join this lunch',
  );
  await login(outsider);
  await expect(db.query('select public.mark_payment($1,true)', [event])).rejects.toThrow(
    'access denied',
  );
  await login(alice);
  await expect(
    db.query("select public.create_cooking_event($1,current_date + 1,'Paid',null,null,450,null)", [
      org,
    ]),
  ).rejects.toThrow();
  const paidEvent = await scalar<string>(
    "select public.create_cooking_event($1,current_date + 1,'Paid',null,null,450,'Cook') as value",
    [org],
  );
  expect(
    await scalar('select price_cents as value from public.cooking_events where id=$1', [paidEvent]),
  ).toBe(450);
});

test('default Supabase grants cannot bypass the RPCs and anonymous access is denied', async () => {
  await login(alice);
  await expect(db.query("insert into public.places(id) values('bypass')")).rejects.toThrow();
  await expect(
    db.query('update public.cooking_events set max_portions=999 where id=$1', [event]),
  ).rejects.toThrow();
  await expect(
    db.query('update public.cooking_event_participants set portions=999 where event_id=$1', [
      event,
    ]),
  ).rejects.toThrow();
  await expect(
    db.query('update public.profiles set id=$1 where id=$2', [outsider, alice]),
  ).rejects.toThrow();
  await db.exec("reset role; set role anon; set request.jwt.claim.sub='';");
  await expect(db.query('select * from public.organizations')).rejects.toThrow();
  await expect(db.query('select * from public.place_ratings')).rejects.toThrow();
  await expect(
    db.query("select public.create_organization('Unauthorized','Berlin')"),
  ).rejects.toThrow();
  await expect(db.query('select public.set_portions($1,1)', [event])).rejects.toThrow();
});

test('OSM cache is group-scoped and members cannot forge external metadata or use service gates', async () => {
  await login(bob);
  expect(
    (await db.query('select * from public.osm_region_cache where organization_id=$1', [org])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query('select * from public.osm_region_cache where organization_id=$1', [otherOrg]))
      .rows,
  ).toHaveLength(0);
  await expect(
    db.query("update public.places set metadata='{}' where id='osm:node:1'"),
  ).rejects.toThrow();
  await expect(
    db.query("select public.add_review($1,'osm:node:999',4,'recommend')", [org]),
  ).rejects.toThrow('verified OpenStreetMap');
  await expect(
    db.query("select public.add_review($1,'old-google-place',4,'recommend')", [org]),
  ).rejects.toThrow('verified OpenStreetMap');
  await expect(db.query("select public.claim_osm_request('nominatim')")).rejects.toThrow();
  await db.exec('reset role; set role service_role;');
  expect(await scalar("select public.claim_osm_request('nominatim') as value")).toBe(true);
  expect(await scalar("select public.claim_osm_request('nominatim') as value")).toBe(false);
});

test('migration preserves old reviews and matching moves only the selected group history', async () => {
  await login(alice);
  const before = (
    await db.query<{ id: string }>(
      'select id,author_id,created_at,stars,comment from public.reviews where place_id=$1',
      ['old-google-place'],
    )
  ).rows;
  expect(before).toHaveLength(1);
  await login(bob);
  await expect(
    db.query('select public.link_legacy_place($1,$2,$3)', [org, 'old-google-place', 'osm:node:1']),
  ).rejects.toThrow('Only the group creator');
  await login(alice);
  expect(
    await scalar('select public.link_legacy_place($1,$2,$3) as value', [
      org,
      'old-google-place',
      'osm:node:1',
    ]),
  ).toBe(1);
  const after = (
    await db.query('select id,author_id,created_at,stars,comment from public.reviews where id=$1', [
      before[0].id,
    ])
  ).rows;
  expect(after).toEqual(before);
  // Matching two histories from the same author must still contribute one opinion.
  expect(
    (await db.query("select * from public.current_reviews where place_id='osm:node:1'")).rows,
  ).toHaveLength(2);
  expect(
    (await db.query("select * from public.place_ratings where place_id='osm:node:1'")).rows[0],
  ).toMatchObject({ count: 2, average: '3.50' });

  expect(
    (await db.query('select * from public.reviews where place_id=$1', ['old-google-place'])).rows,
  ).toHaveLength(0);
  await expect(
    db.query('select public.link_legacy_place($1,$2,$3)', [org, 'old-google-place', 'osm:node:1']),
  ).rejects.toThrow('No reviews remain');
  await login(outsider);
  expect(
    (await db.query('select * from public.reviews where place_id=$1', ['old-google-place'])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query('select * from public.osm_region_cache where organization_id=$1', [org])).rows,
  ).toHaveLength(0);
});

test('changing the search area is creator-only and keeps review history', async () => {
  await login(alice);
  const count = await scalar(
    'select count(*) as value from public.reviews where organization_id=$1',
    [org],
  );
  await login(bob);
  await expect(db.query('select public.set_search_area($1,$2)', [org, 'Hamburg'])).rejects.toThrow(
    'Only the group creator',
  );
  await login(alice);
  await db.query('select public.set_search_area($1,$2)', [org, 'Berlin Mitte, Germany']);
  expect(
    await scalar('select search_area as value from public.organizations where id=$1', [org]),
  ).toBe('Berlin Mitte, Germany');
  expect(
    (await db.query('select * from public.osm_region_cache where organization_id=$1', [org])).rows,
  ).toHaveLength(0);
  expect(
    await scalar('select count(*) as value from public.reviews where organization_id=$1', [org]),
  ).toBe(count);
});

test('organization locations are validated, member-scoped and creator-editable without losing reviews', async () => {
  await login(alice);
  const located = await scalar<string>(
    "select public.create_organization('Located team','Office',52.52,13.4,'Office address') as value",
  );
  expect(
    (await db.query('select latitude,longitude from public.organizations where id=$1', [located]))
      .rows[0],
  ).toEqual({ latitude: 52.52, longitude: 13.4 });
  await expect(
    db.query("select public.create_organization('Invalid','Office',91,13.4,'Office')"),
  ).rejects.toThrow();
  await expect(
    db.query("select public.create_organization('Invalid','Office',null,13.4,'Office')"),
  ).rejects.toThrow('Select an organization location');
  await login(bob);
  expect(
    (await db.query('select * from public.organizations where id=$1', [located])).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.set_organization_location($1,'New office',48.1,11.5,'New address')", [
      located,
    ]),
  ).rejects.toThrow('Only the group creator');
  await expect(db.query('select * from public.osm_location_cache')).rejects.toThrow();
  await login(alice);
  const history = (await db.query('select id from public.reviews where organization_id=$1', [org]))
    .rows;
  await db.query(
    "select public.set_organization_location($1,'New office',48.1,11.5,'New address')",
    [org],
  );
  expect(
    (await db.query('select latitude,longitude from public.organizations where id=$1', [org]))
      .rows[0],
  ).toEqual({ latitude: 48.1, longitude: 11.5 });
  expect(
    (await db.query('select * from public.osm_region_cache where organization_id=$1', [org])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query('select id from public.reviews where organization_id=$1', [org])).rows,
  ).toEqual(history);
  await db.query("select public.set_search_area($1,'Text-only area')", [org]);
  expect(
    (
      await db.query(
        'select latitude,longitude,location_label from public.organizations where id=$1',
        [org],
      )
    ).rows[0],
  ).toEqual({ latitude: null, longitude: null, location_label: null });
  await db.exec("reset role; set role anon; set request.jwt.claim.sub='';");
  await expect(
    db.query("select public.create_organization('Anonymous','Office',52.52,13.4,'Office')"),
  ).rejects.toThrow();
});

test('team cuisine corrections are scoped, validated and survive external metadata refreshes', async () => {
  await db.exec('reset role');
  // A new unreviewed selection is editable only for the group that found it.
  const unreviewed = {
    id: 'osm:way:2',
    provider: 'osm',
    name: 'New lunch',
    types: ['restaurant', 'cuisine:unknown'],
    category: 'Restaurant · Cuisine not listed',
    latitude: 52.52,
    longitude: 13.4,
    hours: [],
    address: 'Berlin',
  };
  await db.query("insert into public.places(id,provider,metadata) values($1,'osm',$2)", [
    unreviewed.id,
    unreviewed,
  ]);
  await db.query(
    "insert into public.osm_region_cache(organization_id,area_query,places) values($1,'Office',$2)",
    [org, [unreviewed]],
  );
  await login(alice);
  await db.query("select public.set_place_cuisines($1,$2,array['italian','pizza','italian'])", [
    org,
    unreviewed.id,
  ]);
  const selected = (
    await db.query(
      'select cuisines,updated_by from public.place_cuisine_overrides where place_id=$1',
      [unreviewed.id],
    )
  ).rows[0];
  expect(selected).toEqual({ cuisines: ['italian', 'pizza'], updated_by: alice });
  await expect(
    db.query("select public.set_place_cuisines($1,$2,array['<script>'])", [org, unreviewed.id]),
  ).rejects.toThrow('Use up to 8 cuisines');
  await expect(
    db.query('select public.set_place_cuisines($1,$2,array[null]::text[])', [org, unreviewed.id]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.set_place_cuisines($1,'old-google-place',array['italian'])", [org]),
  ).rejects.toThrow('OpenStreetMap');
  await expect(
    db.query("select public.set_place_cuisines($1,'osm:node:999',array['italian'])", [org]),
  ).rejects.toThrow('reviewed or found');
  await expect(
    db.query("update public.place_cuisine_overrides set cuisines=array['pizza']"),
  ).rejects.toThrow();
  await login(outsider);
  expect(
    (await db.query('select * from public.place_cuisine_overrides where organization_id=$1', [org]))
      .rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.set_place_cuisines($1,$2,array['pizza'])", [org, unreviewed.id]),
  ).rejects.toThrow('access denied');
  await expect(
    db.query("select public.set_place_cuisines($1,$2,array['pizza'])", [otherOrg, unreviewed.id]),
  ).rejects.toThrow('reviewed or found');
  await db.query("select public.set_place_cuisines($1,'osm:node:1',array['thai'])", [otherOrg]);
  await login(bob);
  await db.query("select public.set_place_cuisines($1,'osm:node:1',array['italian'])", [org]);
  await db.exec('reset role');
  await db.query(
    "update public.places set metadata=jsonb_set(metadata,'{types}','[\"cuisine:japanese\"]'),refreshed_at=now() where id='osm:node:1'",
  );
  await login(alice);
  expect(
    (
      await db.query(
        "select cuisines from public.place_cuisine_overrides where place_id='osm:node:1'",
      )
    ).rows,
  ).toEqual([{ cuisines: ['italian'] }]);
  await db.query("select public.set_place_cuisines($1,'osm:node:1',array[]::text[])", [org]);
  expect(
    (await db.query("select * from public.place_cuisine_overrides where place_id='osm:node:1'"))
      .rows,
  ).toHaveLength(0);
  await login(outsider);
  expect(
    (
      await db.query(
        "select cuisines from public.place_cuisine_overrides where place_id='osm:node:1'",
      )
    ).rows,
  ).toEqual([{ cuisines: ['thai'] }]);
  await db.exec("reset role;set role anon;set request.jwt.claim.sub='';");
  await expect(
    db.query("select public.set_place_cuisines($1,'osm:node:1',array['italian'])", [org]),
  ).rejects.toThrow();
});

test('OSM cuisine values retain canonical hyphens in storage', async () => {
  await login(alice);
  await db.query("select public.set_place_cuisines($1,'osm:node:1',array['tex-mex','pizza'])", [
    org,
  ]);
  expect(
    (
      await db.query(
        "select cuisines from public.place_cuisine_overrides where organization_id=$1 and place_id='osm:node:1'",
        [org],
      )
    ).rows,
  ).toEqual([{ cuisines: ['tex-mex', 'pizza'] }]);
});

test('daily shortlists start empty despite existing reviews and retain old automatic rows privately', async () => {
  await login(alice);
  const overview = await scalar<{ options: unknown[] }>(
    'select public.lunch_overview($1) as value',
    [org],
  );
  expect(overview.options).toEqual([]);
  expect(
    await scalar(
      'select count(*)::int as value from public.daily_lunch_options where organization_id=$1 and not is_shortlisted',
      [org],
    ),
  ).toBe(1);
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  await expect(db.query("select public.vote_lunch_place($1,'osm:node:1')", [org])).rejects.toThrow(
    "today's options",
  );
});

test('daily responses are unique, editable, removable and isolated between organizations', async () => {
  await login(bob);
  await db.query('select public.set_lunch_response($1,null)', [org]);
  await login(alice);
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  await db.query("select public.set_lunch_response($1,'brought_food')", [org]);
  let overview = await scalar<{ mine: string; counts: Record<string, number> }>(
    'select public.lunch_overview($1) as value',
    [org],
  );
  expect(overview.mine).toBe('brought_food');
  expect(overview.counts.brought_food).toBe(1);
  expect(overview.counts.going_out).toBe(0);
  await expect(db.query("select public.set_lunch_response($1,'invalid')", [org])).rejects.toThrow(
    'valid lunch answer',
  );
  await expect(
    db.query("select public.set_lunch_response($1,'going_out')", [otherOrg]),
  ).rejects.toThrow('access denied');
  await expect(
    db.query(
      "insert into public.daily_lunch_responses values($1,public.lunch_day(),$2,'no_lunch')",
      [org, bob],
    ),
  ).rejects.toThrow();
  await db.query('select public.set_lunch_response($1,null)', [org]);
  expect(
    await scalar(
      'select mine is null as value from jsonb_to_record(public.lunch_overview($1)) as x(mine text)',
      [org],
    ),
  ).toBe(true);
});

test('daily nominations validate membership and source; votes require going out and move instead of duplicating', async () => {
  await db.exec('reset role');
  const second = {
    id: 'osm:node:200',
    provider: 'osm',
    name: 'Second lunch',
    types: ['restaurant'],
    hours: [],
    address: 'Berlin',
    category: 'Restaurant',
    latitude: 52.52,
    longitude: 13.4,
  };
  await db.query("insert into public.places(id,provider,metadata) values($1,'osm',$2)", [
    second.id,
    second,
  ]);
  await db.query(
    'update public.osm_region_cache set places=places || $1::jsonb where organization_id=$2',
    [JSON.stringify([second]), org],
  );
  await login(alice);
  await db.query("select public.suggest_lunch_place($1,'osm:node:200')", [org]);
  await db.query("select public.suggest_lunch_place($1,'osm:node:1')", [org]);
  await expect(
    db.query("select public.suggest_lunch_place($1,'old-google-place')", [org]),
  ).rejects.toThrow('reviewed or found');
  await expect(db.query("select public.vote_lunch_place($1,'osm:node:1')", [org])).rejects.toThrow(
    'going out',
  );
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  await db.query("select public.vote_lunch_place($1,'osm:node:1')", [org]);
  await db.query("select public.vote_lunch_place($1,'osm:node:1')", [org]);
  await db.query("select public.vote_lunch_place($1,'osm:node:200')", [org]);
  expect(
    await scalar(
      'select place_id as value from public.daily_lunch_votes where organization_id=$1',
      [org],
    ),
  ).toBe('osm:node:200');
  expect(
    await scalar<number>(
      'select count(*)::int as value from public.daily_lunch_votes where organization_id=$1',
      [org],
    ),
  ).toBe(1);
  await expect(
    db.query("select public.vote_lunch_place($1,'osm:node:99999')", [org]),
  ).rejects.toThrow("today's options");
  await db.query("select public.set_lunch_response($1,'no_lunch')", [org]);
  expect(
    await scalar<number>(
      'select count(*)::int as value from public.daily_lunch_votes where organization_id=$1',
      [org],
    ),
  ).toBe(0);
  await login(outsider);
  expect(
    (await db.query('select * from public.daily_lunch_options where organization_id=$1', [org]))
      .rows,
  ).toHaveLength(0);
  await expect(db.query('select public.lunch_overview($1)', [org])).rejects.toThrow(
    'access denied',
  );
  await expect(db.query('select public.spin_lunch_wheel($1)', [org])).rejects.toThrow(
    'access denied',
  );
});

test('legacy absence answers map to the combined no-lunch choice and remove restaurant participation', async () => {
  await login(alice);
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  await db.query("select public.vote_lunch_place($1,'osm:node:1')", [org]);
  await db.query("select public.set_lunch_response($1,'not_in_office')", [org]);
  const overview = await scalar<{
    mine: string;
    myVote: string | null;
    counts: Record<string, number>;
  }>('select public.lunch_overview($1) as value', [org]);
  expect(overview.mine).toBe('no_lunch');
  expect(overview.counts.ordering_in).toBe(0);
  expect(overview.counts.going_out).toBe(0);
  expect(overview.counts.no_lunch).toBe(1);
  expect(overview.myVote).toBeNull();
  await expect(db.query("select public.vote_lunch_place($1,'osm:node:1')", [org])).rejects.toThrow(
    'going out',
  );
  await expect(db.query('select public.spin_lunch_wheel($1)', [org])).rejects.toThrow('going out');
});

test('merged lunch responses preserve history and ordering in has its own count without restaurant voting', async () => {
  await login(alice);
  const history = (
    await db.query<{ choice: string }>(
      'select choice from public.daily_lunch_responses where organization_id=$1 and lunch_date=public.lunch_day()-20',
      [org],
    )
  ).rows;
  expect(history).toHaveLength(2);
  expect(history.every((row) => row.choice === 'no_lunch')).toBe(true);
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  await db.query("select public.vote_lunch_place($1,'osm:node:1')", [org]);
  await db.query("select public.set_lunch_response($1,'ordering_in')", [org]);
  const overview = await scalar<{
    mine: string;
    myVote: string | null;
    counts: Record<string, number>;
  }>('select public.lunch_overview($1) as value', [org]);
  expect(overview.mine).toBe('ordering_in');
  expect(overview.myVote).toBeNull();
  expect(overview.counts.ordering_in).toBe(1);
  expect(overview.counts.not_in_office).toBeUndefined();
  await expect(db.query('select public.spin_lunch_wheel($1)', [org])).rejects.toThrow('going out');
  await expect(
    db.query("select public.set_lunch_response($1,'ordering_in')", [otherOrg]),
  ).rejects.toThrow('access denied');
});

test('picker prioritizes explicit nominations and restricts fallback to eligible candidates', async () => {
  await login(alice);
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  await db.exec('reset role');
  // Temporarily remove nominations to exercise the filtered fallback.
  const suggestions = (
    await db.query<{ place_id: string; suggested_by: string }>(
      'select place_id,suggested_by from public.daily_lunch_options where organization_id=$1 and lunch_date=public.lunch_day() and suggested_by is not null',
      [org],
    )
  ).rows;
  await db.query(
    'update public.daily_lunch_options set suggested_by=null,is_shortlisted=false where organization_id=$1',
    [org],
  );
  await login(alice);
  expect(
    await scalar("select public.spin_lunch_wheel($1,array['osm:node:1']) as value", [org]),
  ).toBe('osm:node:1');
  const selected = await scalar<{ options: { place: { id: string } }[] }>(
    'select public.lunch_overview($1) as value',
    [org],
  );
  expect(selected.options.map((option) => option.place.id)).toEqual(['osm:node:1']);
  await db.exec('reset role');
  await db.query(
    'update public.daily_lunch_options set is_shortlisted=false where organization_id=$1',
    [org],
  );
  await login(alice);
  await expect(
    db.query('select public.spin_lunch_wheel($1,array[]::text[])', [org]),
  ).rejects.toThrow('No eligible restaurants');
  await expect(
    db.query("select public.spin_lunch_wheel($1,array['osm:node:99999'])", [org]),
  ).rejects.toThrow('No eligible restaurants');
  // A reviewed option seeded automatically must become nominated on explicit suggestion.
  await db.query("select public.suggest_lunch_place($1,'osm:node:1')", [org]);
  expect(
    await scalar("select public.spin_lunch_wheel($1,array['osm:node:200']) as value", [org]),
  ).toBe('osm:node:1');
  const overview = await scalar<{ options: { place: { id: string }; nominated: boolean }[] }>(
    'select public.lunch_overview($1) as value',
    [org],
  );
  expect(overview.options.find((option) => option.place.id === 'osm:node:1')?.nominated).toBe(true);
  await db.exec('reset role');
  await db.query(
    'update public.daily_lunch_options set suggested_by=null,is_shortlisted=false where organization_id=$1',
    [org],
  );
  for (const suggestion of suggestions)
    await db.query(
      'update public.daily_lunch_options set suggested_by=$1,is_shortlisted=true where organization_id=$2 and place_id=$3 and lunch_date=public.lunch_day()',
      [suggestion.suggested_by, org, suggestion.place_id],
    );
  await login(alice);
  await db.query("select public.set_lunch_response($1,'no_lunch')", [org]);
});

test('the daily wheel saves a shared eligible result and never selects another organization or old day', async () => {
  await login(alice);
  await expect(db.query('select public.spin_lunch_wheel($1)', [org])).rejects.toThrow('going out');
  await db.query("select public.set_lunch_response($1,'going_out')", [org]);
  const picked = await scalar<string>('select public.spin_lunch_wheel($1) as value', [org]);
  const overview = await scalar<{
    day: string;
    pickedPlaceId: string;
    options: { place: { id: string } }[];
  }>('select public.lunch_overview($1) as value', [org]);
  expect(overview.options.map((x) => x.place.id)).toContain(picked);
  expect(overview.pickedPlaceId).toBe(picked);
  await login(bob);
  expect(
    (await scalar<{ pickedPlaceId: string }>('select public.lunch_overview($1) as value', [org]))
      .pickedPlaceId,
  ).toBe(picked);
  await login(outsider);
  await db.query("select public.set_lunch_response($1,'going_out')", [otherOrg]);
  await expect(
    db.query("select public.spin_lunch_wheel($1,array['osm:node:200'])", [otherOrg]),
  ).rejects.toThrow('No eligible restaurants');
  expect(await scalar('select public.spin_lunch_wheel($1) as value', [otherOrg])).toBe(
    'osm:node:1',
  );
  await db.exec('reset role');
  await db.query(
    "insert into public.daily_lunch_responses values($1,public.lunch_day()-1,$2,'going_out') on conflict do nothing",
    [org, bob],
  );
  await login(bob);
  expect(
    (await scalar<{ mine: string | null }>('select public.lunch_overview($1) as value', [org]))
      .mine,
  ).toBe(null);
  await db.exec("reset role;set role anon;set request.jwt.claim.sub='';");
  await expect(db.query('select public.lunch_overview($1)', [org])).rejects.toThrow();
});

test('cooking notifications are private, persist read/dismiss state and quick join preserves portions', async () => {
  await login(alice);
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Notification lunch',null,3,425,'Alice') as value",
    [org],
  );
  await login(bob);
  type Inbox = {
    unread: number;
    items: { id: string; event_id: string; kind: string; read_at: string | null }[];
  };
  const inbox = () => scalar<Inbox>('select public.notification_inbox($1) as value', [org]);
  const invitation = (await inbox()).items.find(
    (n) => n.event_id === meal && n.kind === 'cooking_scheduled',
  )!;
  expect(invitation).toBeDefined();
  await db.query('select public.update_notification($1,$2,false)', [org, invitation.id]);
  expect((await inbox()).items.find((n) => n.id === invitation.id)?.read_at).not.toBeNull();
  await login(alice);
  expect((await inbox()).items.find((n) => n.id === invitation.id)).toBeUndefined();
  await expect(
    db.query('select public.update_notification($1,$2,true)', [org, invitation.id]),
  ).rejects.toThrow('access denied');
  await expect(
    db.query('select public.join_notification_lunch($1,$2)', [org, invitation.id]),
  ).rejects.toThrow('access denied');
  await login(outsider);
  await expect(inbox()).rejects.toThrow('access denied');
  expect(
    (await db.query('select * from public.notifications where event_id=$1', [meal])).rows,
  ).toHaveLength(0);
  await login(bob);
  await expect(
    db.query(
      "insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind) values($1,$2,$3,$2,'payment_due')",
      [org, bob, meal],
    ),
  ).rejects.toThrow('permission denied');
  await db.query('select public.update_notification($1,$2,true)', [org, invitation.id]);
  expect((await inbox()).items.find((n) => n.id === invitation.id)).toBeUndefined();
  await db.query('select public.join_notification_lunch($1,$2)', [org, invitation.id]);
  expect(
    await scalar(
      'select portions as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(1);
  expect((await inbox()).items.find((n) => n.id === invitation.id)).toBeUndefined();
  const due = (await inbox()).items.find((n) => n.event_id === meal && n.kind === 'payment_due')!;
  expect(due).toBeDefined();
  await db.exec('reset role');
  await expect(
    db.query('update public.notifications set dismissed_at=now() where id=$1', [due.id]),
  ).rejects.toThrow('payment_reminders_cannot_be_dismissed');
  await expect(
    db.query('update public.notifications set read_at=now() where id=$1', [due.id]),
  ).rejects.toThrow('payment_reminders_cannot_be_read');
  // A second invitation gives mark-all both a normal notice and a persistent alert.
  await login(alice);
  const otherMeal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Another invitation') as value",
    [org],
  );
  await login(bob);
  const otherInvitation = (await inbox()).items.find(
    (n) => n.event_id === otherMeal && n.kind === 'cooking_scheduled',
  )!;
  expect(otherInvitation.read_at).toBeNull();
  await db.query('select public.read_all_notifications($1)', [org]);
  expect((await inbox()).items.find((n) => n.id === otherInvitation.id)?.read_at).not.toBeNull();
  expect((await inbox()).items.find((n) => n.id === due.id)?.read_at).toBeNull();
  expect((await inbox()).unread).toBeGreaterThan(0);

  await expect(
    db.query('select public.update_notification($1,$2,true)', [org, due.id]),
  ).rejects.toThrow('Unpaid reminders cannot be dismissed');
  expect((await inbox()).items.find((n) => n.id === due.id)?.read_at).toBeNull();
  await db.query('select public.update_notification($1,$2,false)', [org, due.id]);
  await db.query('select public.set_portions($1,1)', [meal]);
  expect((await inbox()).items.find((n) => n.id === due.id)).toBeDefined();
  expect((await inbox()).items.find((n) => n.id === due.id)?.read_at).toBeNull();
  await db.query('select public.set_portions($1,2)', [meal]);
  expect((await inbox()).items.find((n) => n.id === due.id)?.read_at).toBeNull();
  await db.query('select public.mark_payment($1,true)', [meal]);
  await db.query('select public.join_notification_lunch($1,$2)', [org, invitation.id]);
  expect(
    await scalar(
      'select portions as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(2);
  expect(
    await scalar(
      'select paid as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(true);
  expect(
    (await inbox()).items.find((n) => n.event_id === meal && n.kind === 'payment_due'),
  ).toBeUndefined();
  await login(alice);
  const paid = (await inbox()).items.find(
    (n) => n.event_id === meal && n.kind === 'payment_received',
  )!;
  expect(paid).toBeDefined();
  await db.query('select public.read_all_notifications($1)', [org]);
  expect((await inbox()).unread).toBe(0);
  await login(bob);
  await db.query('select public.mark_payment($1,false)', [meal]);
  await login(alice);
  expect((await inbox()).items.find((n) => n.id === paid.id)).toBeUndefined();
  await login(bob);
  await db.query('select public.set_portions($1,0)', [meal]);
  expect(
    (await inbox()).items.find((n) => n.event_id === meal && n.kind === 'payment_due'),
  ).toBeUndefined();
});

test('quick joining enforces capacity and free lunches have no payment notifications', async () => {
  await login(alice);
  const full = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Full lunch',null,1,0,null) as value",
    [org],
  );
  await db.query('select public.set_portions($1,1)', [full]);
  await login(bob);
  const invitation = await scalar<string>(
    "select id as value from public.notifications where event_id=$1 and kind='cooking_scheduled'",
    [full],
  );
  await expect(
    db.query('select public.join_notification_lunch($1,$2)', [org, invitation]),
  ).rejects.toThrow('Not enough portions');
  expect(
    await scalar('select read_at as value from public.notifications where id=$1', [invitation]),
  ).toBeNull();
  await login(alice);
  await db.query('select public.set_portions($1,0)', [full]);
  await login(bob);
  await db.query('select public.join_notification_lunch($1,$2)', [org, invitation]);
  await db.query('select public.mark_payment($1,true)', [full]);
  await login(alice);
  expect(
    await scalar<number>(
      "select count(*)::int as value from public.notifications where event_id=$1 and kind in ('payment_due','payment_received')",
      [full],
    ),
  ).toBe(0);
  await db.exec('reset role; set role anon;');
  await expect(db.query('select public.notification_inbox($1)', [org])).rejects.toThrow(
    'permission denied',
  );
});

test('OSM fact refresh leases protect source updates and sync search caches without resetting reviews', async () => {
  await db.exec('reset role');
  await db.query("update public.places set refreshed_at=null where id='osm:node:1'");
  const before = await scalar<Record<string, unknown>>(
    "select metadata as value from public.places where id='osm:node:1'",
  );
  await db.query(
    'update public.osm_region_cache set places=places || $1::jsonb where organization_id=$2',
    [JSON.stringify([before]), org],
  );
  const cacheDate = await scalar(
    'select refreshed_at as value from public.osm_region_cache where organization_id=$1',
    [org],
  );
  const reviews = await scalar('select count(*) as value from public.reviews');
  await login(alice);
  await expect(
    db.query("select * from public.claim_osm_place_refresh(array['osm:node:1'],false)"),
  ).rejects.toThrow('permission denied');
  await db.exec('reset role; set role service_role;');
  const leases = (
    await db.query<{ place_id: string; token: string }>(
      "select * from public.claim_osm_place_refresh(array['osm:node:1','osm:node:999'],false)",
    )
  ).rows;
  expect(leases).toHaveLength(1);
  expect(leases[0].place_id).toBe('osm:node:1');
  expect(
    (await db.query("select * from public.claim_osm_place_refresh(array['osm:node:1'],true)")).rows,
  ).toHaveLength(0);
  const updated = {
    ...before,
    types: ['restaurant', 'cuisine:thai'],
    category: 'Restaurant · Thai',
    updatedAt: new Date().toISOString(),
  };
  await db.query('select public.finish_osm_place_refresh($1,$2,true)', [
    '00000000-0000-0000-0000-000000000000',
    JSON.stringify([updated]),
  ]);
  expect(await scalar("select metadata as value from public.places where id='osm:node:1'")).toEqual(
    before,
  );
  await db.query('select public.finish_osm_place_refresh($1,$2,true)', [
    leases[0].token,
    JSON.stringify([updated]),
  ]);
  expect(await scalar("select metadata as value from public.places where id='osm:node:1'")).toEqual(
    updated,
  );
  expect(
    await scalar(
      "select item->'types' as value from public.osm_region_cache,jsonb_array_elements(places) item where organization_id=$1 and item->>'id'='osm:node:1'",
      [org],
    ),
  ).toEqual(updated.types);
  expect(
    await scalar(
      'select refreshed_at as value from public.osm_region_cache where organization_id=$1',
      [org],
    ),
  ).toEqual(cacheDate);
  await db.exec('reset role');
  expect(await scalar('select count(*) as value from public.reviews')).toBe(reviews);
  await db.exec('set role service_role;');
  expect(
    (await db.query("select * from public.claim_osm_place_refresh(array['osm:node:1'],true)")).rows,
  ).toHaveLength(0);
  await db.query(
    "update public.osm_place_refresh set checked_at=now()-interval '6 minutes' where place_id='osm:node:1'",
  );
  const retry = (
    await db.query<{ token: string }>(
      "select * from public.claim_osm_place_refresh(array['osm:node:1'],true)",
    )
  ).rows[0];
  expect(retry).toBeDefined();
  await db.query('select public.finish_osm_place_refresh($1,$2,false)', [retry.token, '[]']);
  expect(
    (await db.query("select * from public.claim_osm_place_refresh(array['osm:node:1'],true)")).rows,
  ).toHaveLength(0);
  expect(await scalar("select metadata as value from public.places where id='osm:node:1'")).toEqual(
    updated,
  );
});

test('live signals cover cooking, payment deletion and private inbox changes without exposing content', async () => {
  await login(alice);
  const revision = () =>
    scalar<number>(
      "select revision as value from public.organization_signals where organization_id=$1 and topic='cooking'",
      [org],
    );
  const before = Number(await revision());
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Live lunch',null,3,500,'Alice') as value",
    [org],
  );
  expect(Number(await revision())).toBeGreaterThan(before);
  expect(
    (
      await db.query('select * from public.organization_signals where organization_id=$1', [
        otherOrg,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        'select * from public.inbox_signals where organization_id=$1 and recipient_id=$2',
        [org, bob],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.bump_organization_signal($1,'cooking')", [org]),
  ).rejects.toThrow('permission denied');
  await expect(
    db.query('update public.organization_signals set revision=0 where organization_id=$1', [org]),
  ).rejects.toThrow('permission denied');
  await login(bob);
  const notice = await scalar<Record<string, unknown>>(
    'select to_jsonb(s) as value from public.inbox_signals s where organization_id=$1 and recipient_id=$2',
    [org, bob],
  );
  expect(Object.keys(notice).sort()).toEqual([
    'notification_id',
    'organization_id',
    'recipient_id',
    'revision',
  ]);
  await db.query('select public.set_portions($1,1)', [meal]);
  expect(Number(await revision())).toBeGreaterThan(before + 1);
  await db.query('select public.mark_payment($1,true)', [meal]);
  await login(alice);
  expect(
    Number(
      await scalar(
        'select revision as value from public.inbox_signals where organization_id=$1 and recipient_id=$2',
        [org, alice],
      ),
    ),
  ).toBeGreaterThan(0);
  const previous = Number(await revision());
  await db.exec('reset role');
  await db.query('delete from public.cooking_events where id=$1', [meal]);
  await login(alice);
  expect(Number(await revision())).toBeGreaterThan(previous);
  await login(outsider);
  expect(
    (await db.query('select * from public.inbox_signals where organization_id=$1', [org])).rows,
  ).toHaveLength(0);
});

test('star-only review saves preserve history, count one opinion and enforce membership and validation', async () => {
  await login(alice);
  const result = await scalar<string>(
    "select public.save_review($1,'osm:node:1',4,'Stars alone') as value",
    [org],
  );
  const review = (await db.query('select * from public.reviews where id=$1', [result])).rows[0];
  expect(review).toMatchObject({
    stars: 4,
    comment: 'Stars alone',
    recommendation: null,
    author_id: alice,
  });
  expect(
    await scalar("select public.save_review($1,'osm:node:1',4,'Stars alone') as value", [org]),
  ).toBe(result);
  await db.query("select public.save_review($1,'osm:node:1',2,'Changed my mind')", [org]);
  expect(
    (
      await db.query(
        "select * from public.current_reviews where organization_id=$1 and place_id='osm:node:1' and author_id=$2",
        [org, alice],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.query("select public.save_review($1,'osm:node:1',0,null)", [org]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.save_review($1,'osm:node:1',null,null)", [org]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.save_review($1,'old-google-place',4,null)", [org]),
  ).rejects.toThrow('verified');
  await expect(
    db.query("select public.save_review($1,'osm:node:1',4,null)", [otherOrg]),
  ).rejects.toThrow('access denied');
  const rating = (
    await db.query(
      "select * from public.place_ratings where organization_id=$1 and place_id='osm:node:1'",
      [org],
    )
  ).rows[0];
  expect(rating).not.toHaveProperty('recommend');
});

test('office cooking selects attendance, clears votes and leaves later manual choices intact', async () => {
  await login(alice);
  const team = await scalar<string>(
    "select public.create_organization('Attendance team','Berlin') as value",
  );
  await db.exec('reset role');
  await db.query(
    "insert into public.osm_region_cache(organization_id,area_query,places,refreshed_at) values($1,'Berlin',$2,now())",
    [team, [{ id: 'osm:node:1' }]],
  );
  await login(alice);
  await db.query("select public.suggest_lunch_place($1,'osm:node:1')", [team]);
  await db.query("select public.set_lunch_response($1,'going_out')", [team]);
  await db.query("select public.vote_lunch_place($1,'osm:node:1')", [team]);
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Lunch') as value",
    [team],
  );
  await db.query('select public.set_portions($1,1)', [meal]);
  const read = () =>
    scalar<{ mine: string | null; myVote: string | null; joinedCooking: boolean }>(
      'select public.lunch_overview($1) as value',
      [team],
    );
  expect(await read()).toMatchObject({ mine: 'brought_food', myVote: null, joinedCooking: true });
  await db.query("select public.set_lunch_response($1,'ordering_in')", [team]);
  await db.query('select public.set_portions($1,2)', [meal]);
  expect((await read()).mine).toBe('ordering_in');
  await db.query('select public.set_portions($1,0)', [meal]);
  expect(await read()).toMatchObject({ mine: 'ordering_in', joinedCooking: false });
  await db.query('select public.set_portions($1,1)', [meal]);
  await db.query("select public.set_lunch_response($1,'brought_food')", [team]);
  await db.query('select public.set_portions($1,0)', [meal]);
  expect((await read()).mine).toBe('brought_food');
  await db.query('select public.set_portions($1,1)', [meal]);
  await db.query('select public.set_portions($1,0)', [meal]);
  expect((await read()).mine).toBe('brought_food');
  await db.query('select public.set_lunch_response($1,null)', [team]);
  await db.query('select public.set_portions($1,1)', [meal]);
  const second = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Second lunch') as value",
    [team],
  );
  await db.query('select public.set_portions($1,1)', [second]);
  await db.query('select public.set_portions($1,0)', [meal]);
  expect((await read()).mine).toBe('brought_food');
  await db.query('select public.set_portions($1,0)', [second]);
  expect((await read()).mine).toBeNull();
  await db.query("select public.set_lunch_response($1,'no_lunch')", [team]);
  const future = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day()+1,'Tomorrow') as value",
    [team],
  );
  await db.query('select public.set_portions($1,1)', [future]);
  expect((await read()).mine).toBe('no_lunch');
  expect(
    await scalar(
      'select choice as value from public.daily_lunch_responses where organization_id=$1 and lunch_date=public.lunch_day()+1',
      [team],
    ),
  ).toBe('brought_food');
  await db.query('select public.set_portions($1,0)', [future]);
  expect(
    await scalar(
      'select count(*)::int as value from public.daily_lunch_responses where organization_id=$1 and lunch_date=public.lunch_day()+1',
      [team],
    ),
  ).toBe(0);
});

test('notification quick join sets office attendance and repeated join preserves a manual answer', async () => {
  await login(alice);
  const team = await scalar<string>(
    "select public.create_organization('Quick join team','Berlin') as value",
  );
  const invite = await scalar<string>('select public.organization_invite($1) as value', [team]);
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Group lunch') as value",
    [team],
  );
  await login(bob);
  await db.query('select public.join_organization($1)', [invite]);
  // Create another lunch after Bob joined so the invitation is sent to him.
  await login(alice);
  const other = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Invited lunch') as value",
    [team],
  );
  await login(bob);
  const notice = await scalar<string>(
    "select id as value from public.notifications where event_id=$1 and kind='cooking_scheduled'",
    [other],
  );
  await db.query('select public.join_notification_lunch($1,$2)', [team, notice]);
  expect(
    await scalar<{ mine: string; joinedCooking: boolean }>(
      'select public.lunch_overview($1) as value',
      [team],
    ),
  ).toMatchObject({ mine: 'brought_food', joinedCooking: true });
  await db.query("select public.set_lunch_response($1,'ordering_in')", [team]);
  await db.query('select public.join_notification_lunch($1,$2)', [team, notice]);
  expect(
    (await scalar<{ mine: string }>('select public.lunch_overview($1) as value', [team])).mine,
  ).toBe('ordering_in');
});

test('meal tags are predefined, default empty and editable only by the event organizer', async () => {
  await login(alice);
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Tagged lunch',null,null,0,null,array['vegan','spicy','vegan']) as value",
    [org],
  );
  expect(
    await scalar('select flags as value from public.cooking_events where id=$1', [meal]),
  ).toEqual(['spicy', 'vegan']);
  const ordinary = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day(),'Ordinary lunch') as value",
    [org],
  );
  expect(
    await scalar('select flags as value from public.cooking_events where id=$1', [ordinary]),
  ).toEqual([]);
  await db.query(
    "select public.set_cooking_flags($1,array['vegetarian','gluten_free','dairy_free'])",
    [meal],
  );
  expect(
    await scalar('select flags as value from public.cooking_events where id=$1', [meal]),
  ).toEqual(['dairy_free', 'gluten_free', 'vegetarian']);
  await expect(
    db.query("select public.set_cooking_flags($1,array['unknown'])", [meal]),
  ).rejects.toThrow('predefined');
  await expect(
    db.query('select public.set_cooking_flags($1,array[null]::text[])', [meal]),
  ).rejects.toThrow('predefined');
  await expect(
    db.query(
      "select public.create_cooking_event($1,public.lunch_day(),'Bad flags',null,null,0,null,array['unknown'])",
      [org],
    ),
  ).rejects.toThrow('predefined');
  await expect(
    db.query("update public.cooking_events set flags=array['vegan'] where id=$1", [meal]),
  ).rejects.toThrow();
  await login(bob);
  expect(
    await scalar('select flags as value from public.cooking_events where id=$1', [meal]),
  ).toEqual(['dairy_free', 'gluten_free', 'vegetarian']);
  await expect(
    db.query("select public.set_cooking_flags($1,array['vegan'])", [meal]),
  ).rejects.toThrow('Only the organizer');
  await login(outsider);
  await expect(
    db.query("select public.set_cooking_flags($1,array['vegan'])", [meal]),
  ).rejects.toThrow('access denied');
  expect(
    (await db.query('select flags from public.cooking_events where id=$1', [meal])).rows,
  ).toHaveLength(0);
  await login(alice);
  await db.query('select public.set_cooking_flags($1,array[]::text[])', [meal]);
  expect(
    await scalar('select flags as value from public.cooking_events where id=$1', [meal]),
  ).toEqual([]);
});

test('cooking signup deadlines validate times and only organizers may change or remove them', async () => {
  await login(alice);
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day()+1,'Deadline validation') as value",
    [org],
  );
  expect(
    await scalar('select signup_deadline as value from public.cooking_events where id=$1', [meal]),
  ).toBeNull();
  await db.query(
    "select public.set_cooking_signup_deadline($1,clock_timestamp()+interval '1 hour')",
    [meal],
  );
  expect(
    await scalar(
      'select signup_deadline is not null as value from public.cooking_events where id=$1',
      [meal],
    ),
  ).toBe(true);
  await expect(
    db.query(
      "select public.set_cooking_signup_deadline($1,clock_timestamp()-interval '1 minute')",
      [meal],
    ),
  ).rejects.toThrow('in the future');
  await expect(
    db.query(
      "select public.set_cooking_signup_deadline($1,(public.lunch_day()+3)::timestamp at time zone 'Europe/Berlin')",
      [meal],
    ),
  ).rejects.toThrow('on or before');
  await expect(
    db.query("select public.set_cooking_signup_deadline($1,'infinity')", [meal]),
  ).rejects.toThrow('in the future');
  await expect(
    db.query(
      "select public.create_cooking_event($1,public.lunch_day()+1,signup_until=>clock_timestamp()-interval '1 minute')",
      [org],
    ),
  ).rejects.toThrow('in the future');
  await expect(
    db.query('update public.cooking_events set signup_deadline=null where id=$1', [meal]),
  ).rejects.toThrow('permission denied');
  await login(bob);
  await expect(
    db.query('select public.set_cooking_signup_deadline($1,null,true)', [meal]),
  ).rejects.toThrow('Only the organizer');
  await login(outsider);
  await expect(db.query('select public.set_cooking_signup_deadline($1)', [meal])).rejects.toThrow(
    'access denied',
  );
  await login(alice);
  await db.query('select public.set_cooking_signup_deadline($1,null,true)', [meal]);
  expect(
    await scalar(
      'select signup_deadline <= clock_timestamp() as value from public.cooking_events where id=$1',
      [meal],
    ),
  ).toBe(true);
  await db.query('select public.set_cooking_signup_deadline($1)', [meal]);
  expect(
    await scalar('select signup_deadline as value from public.cooking_events where id=$1', [meal]),
  ).toBeNull();
  await db.exec('reset role');
  await expect(
    db.query("update public.cooking_events set signup_deadline='infinity' where id=$1", [meal]),
  ).rejects.toThrow('valid_signup_deadline');
});

test('closed cooking blocks new bookings and increases while allowing reduction, payment, leaving and reopening', async () => {
  await login(alice);
  const meal = await scalar<string>(
    "select public.create_cooking_event($1,public.lunch_day()+1,'Deadline lunch',null,10,425,'Alice',array['vegan'],clock_timestamp()+interval '1 hour') as value",
    [org],
  );
  await login(bob);
  const invitation = await scalar<string>(
    "select id as value from public.notifications where event_id=$1 and kind='cooking_scheduled'",
    [meal],
  );
  const inbox = await scalar<{ items: { id: string; signup_deadline: string }[] }>(
    'select public.notification_inbox($1) as value',
    [org],
  );
  expect(inbox.items.find((item) => item.id === invitation)?.signup_deadline).toBeTruthy();
  await db.query('select public.set_portions($1,2)', [meal]);
  await db.query('select public.mark_payment($1,true)', [meal]);
  await login(alice);
  await db.query('select public.set_cooking_signup_deadline($1,null,true)', [meal]);
  await expect(db.query('select public.set_portions($1,1)', [meal])).rejects.toThrow(
    'Signup is closed',
  );
  await login(bob);
  await expect(db.query('select public.set_portions($1,3)', [meal])).rejects.toThrow(
    'Signup is closed',
  );
  await db.query('select public.set_portions($1,2)', [meal]);
  expect(
    await scalar(
      'select paid as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(true);
  await db.query('select public.join_notification_lunch($1,$2)', [org, invitation]);
  expect(
    await scalar(
      'select portions as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(2);
  await db.query('select public.set_portions($1,1)', [meal]);
  await db.query('select public.mark_payment($1,true)', [meal]);
  expect(
    await scalar(
      'select paid as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(true);
  await db.query('select public.set_portions($1,0)', [meal]);
  await expect(
    db.query('select public.join_notification_lunch($1,$2)', [org, invitation]),
  ).rejects.toThrow('Signup is closed');
  await expect(db.query('select public.set_portions($1,1)', [meal])).rejects.toThrow(
    'Signup is closed',
  );
  await login(alice);
  await db.query('select public.set_cooking_signup_deadline($1,null)', [meal]);
  await login(bob);
  await db.query('select public.join_notification_lunch($1,$2)', [org, invitation]);
  expect(
    await scalar(
      'select portions as value from public.cooking_event_participants where event_id=$1 and user_id=$2',
      [meal, bob],
    ),
  ).toBe(1);
});
