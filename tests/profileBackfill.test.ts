import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { bootstrap } from './bootstrap';

test('accounts created before schema installation can create organizations without losing existing profile names', async () => {
  const db = new PGlite();
  const directory = resolve('supabase/migrations');
  const legacy = '00000000-0000-0000-0000-000000000101';
  const existing = '00000000-0000-0000-0000-000000000102';
  const fresh = '00000000-0000-0000-0000-000000000103';
  const repair = readFileSync(resolve(directory, '202610160043_backfill_profiles.sql'), 'utf8');
  try {
    await db.exec(bootstrap);
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
      legacy,
      { full_name: 'Google Colleague' },
    ]);
    for (const file of readdirSync(directory).sort()) {
      if (!file.endsWith('.sql')) continue;
      if (file === '202610160043_backfill_profiles.sql') {
        await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
          existing,
          { name: 'Provider Name' },
        ]);
        await db.query('update public.profiles set display_name=$1 where id=$2', [
          'Chosen Name',
          existing,
        ]);
      }
      await db.exec(readFileSync(resolve(directory, file), 'utf8'));
    }
    await db.exec(repair);
    expect(
      (await db.query('select display_name from public.profiles where id=$1', [legacy])).rows,
    ).toEqual([{ display_name: 'Google Colleague' }]);
    expect(
      (await db.query('select display_name from public.profiles where id=$1', [existing])).rows,
    ).toEqual([{ display_name: 'Chosen Name' }]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${legacy}';`);
    const result = await db.query<{ org: string }>(
      "select public.create_organization('Team','Cologne',50.936,6.939,'Rudolfplatz 14') as org",
    );
    expect(
      (
        await db.query(
          'select role from public.organization_memberships where organization_id=$1',
          [result.rows[0].org],
        )
      ).rows,
    ).toEqual([{ role: 'admin' }]);
    await db.exec('reset role');
    await db.query('insert into auth.users(id) values($1)', [fresh]);
    expect(
      (await db.query('select display_name from public.profiles where id=$1', [fresh])).rows,
    ).toEqual([{ display_name: 'Colleague' }]);
  } finally {
    await db.close();
  }
}, 20000);
