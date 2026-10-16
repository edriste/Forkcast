import { expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrate } from '../scripts/migrate.mjs';
import { bootstrap } from './bootstrap';
import { runtimeConfiguration } from '../deploy/write-runtime-config.mjs';

test('runtime configuration contains only public values and safely serializes untrusted strings', () => {
  const env = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://api.example.test',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    EXPO_PUBLIC_TERMS_URL: 'https://example.test/</script>"x',
    OPENROUTESERVICE_API_KEY: 'private-route-key',
    SERVICE_ROLE_KEY: 'private-service-key',
  };
  const text = runtimeConfiguration(env);
  expect(text).not.toContain('private-');
  expect(text).not.toContain('</script>');
  const config = JSON.parse(
    text
      .slice(text.indexOf('=') + 1)
      .trim()
      .slice(0, -1),
  );
  expect(config.EXPO_PUBLIC_TERMS_URL).toBe(env.EXPO_PUBLIC_TERMS_URL);
  expect(config.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED).toBe('false');
  expect(() =>
    runtimeConfiguration({ ...env, EXPO_PUBLIC_SUPABASE_URL: 'javascript:alert(1)' }),
  ).toThrow();
  for (const key of [
    'sb_secret_test',
    `a.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.b`,
  ])
    expect(() =>
      runtimeConfiguration({ ...env, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }),
    ).toThrow();
});

test(
  'self-hosted migrations are repeatable, checksum-protected and roll back a failed file',
  { timeout: 20000 },
  async () => {
    const db = new PGlite();
    const client = {
      query: async (sql, params) => (params ? db.query(sql, params) : (await db.exec(sql)).at(-1)),
    };
    const directory = await mkdtemp(resolve(tmpdir(), 'forkcast-migrations-'));
    try {
      await db.exec('create role anon; create role authenticated;');
      await writeFile(
        resolve(directory, '001_first.sql'),
        'create table first_table(id integer primary key);',
      );
      await migrate(client, directory, () => {});
      await migrate(client, directory, () => {});
      expect(
        (await db.query('select count(*)::int as count from forkcast_private.schema_migrations'))
          .rows[0].count,
      ).toBe(1);
      await writeFile(
        resolve(directory, '002_failed.sql'),
        'create table second_table(id int); select missing_function();',
      );
      await expect(migrate(client, directory, () => {})).rejects.toThrow('002_failed.sql');
      expect(
        (await db.query("select to_regclass('public.second_table') as table_name")).rows[0]
          .table_name,
      ).toBeNull();
      await writeFile(resolve(directory, '002_failed.sql'), 'create table second_table(id int);');
      await migrate(client, directory, () => {});
      await writeFile(resolve(directory, '001_first.sql'), 'create table changed_table(id int);');
      await expect(migrate(client, directory, () => {})).rejects.toThrow(
        'Applied migration changed',
      );
      await writeFile(
        resolve(directory, '001_first.sql'),
        'create table first_table(id integer primary key);',
      );
      await writeFile(resolve(directory, '000_earlier.sql'), 'create table earlier_table(id int);');
      await expect(migrate(client, directory, () => {})).rejects.toThrow('Out-of-order migration');
      expect(
        (await db.query("select to_regclass('public.earlier_table') as name")).rows[0].name,
      ).toBeNull();
      await rm(resolve(directory, '000_earlier.sql'));
      await rm(resolve(directory, '001_first.sql'));
      await expect(migrate(client, directory, () => {})).rejects.toThrow(
        'Applied migration changed or is missing',
      );
    } finally {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'the complete Forkcast schema installs and reruns on initialized Supabase interfaces',
  { timeout: 20000 },
  async () => {
    const db = new PGlite();
    const client = {
      query: async (sql, params) => (params ? db.query(sql, params) : (await db.exec(sql)).at(-1)),
    };
    try {
      await db.exec(bootstrap);
      await migrate(client, resolve('supabase/migrations'), () => {});
      await migrate(client, resolve('supabase/migrations'), () => {});
      expect(
        (await db.query('select count(*)::int as count from forkcast_private.schema_migrations'))
          .rows[0].count,
      ).toBe(
        (await readdir(resolve('supabase/migrations'))).filter((file) => file.endsWith('.sql'))
          .length,
      );
      expect(
        (await db.query("select to_regclass('public.walking_distance_cache') as name")).rows[0]
          .name,
      ).toBe('walking_distance_cache');
    } finally {
      await db.close();
    }
  },
);

test('the migration runner refuses an existing untracked Forkcast schema', async () => {
  const db = new PGlite();
  const client = {
    query: async (sql, params) => (params ? db.query(sql, params) : (await db.exec(sql)).at(-1)),
  };
  try {
    await db.exec('create table public.profiles(id integer);');
    await expect(migrate(client, undefined, () => {})).rejects.toThrow(
      'Keep using its original migration workflow',
    );
    expect(
      (await db.query("select to_regnamespace('forkcast_private') as name")).rows[0].name,
    ).toBeNull();
  } finally {
    await db.close();
  }
});
