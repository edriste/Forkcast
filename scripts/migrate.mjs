import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

/** Apply only Forkcast migrations to an initialized Supabase database, never plain Postgres. */
export async function migrate(
  client,
  directory = resolve('supabase/migrations'),
  log = console.log,
) {
  await client.query("select pg_advisory_lock(hashtext('forkcast-schema-migrations'))");
  try {
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    const entries = await Promise.all(
      files.map(async (name) => {
        const sql = await readFile(resolve(directory, name), 'utf8');
        return { name, sql, hash: createHash('sha256').update(sql).digest('hex') };
      }),
    );
    const existing = await client.query(
      "select to_regclass('forkcast_private.schema_migrations') as history, to_regclass('public.profiles') as profiles",
    );
    if (!existing.rows[0].history && existing.rows[0].profiles)
      throw new Error(
        'Existing Forkcast schema has no deployment migration history. Keep using its original migration workflow; do not baseline an existing database automatically.',
      );
    await client.query('create schema if not exists forkcast_private');
    await client.query('revoke all on schema forkcast_private from public');
    await client.query(
      'create table if not exists forkcast_private.schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null default now())',
    );
    await client.query(
      'revoke all on forkcast_private.schema_migrations from public,anon,authenticated',
    );
    const applied = (
      await client.query(
        'select name,checksum from forkcast_private.schema_migrations order by name',
      )
    ).rows;
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    for (const row of applied) {
      if (!byName.has(row.name) || byName.get(row.name).hash !== row.checksum)
        throw new Error(`Applied migration changed or is missing: ${row.name}`);
    }
    const names = new Set(applied.map((row) => row.name));
    const last = applied.at(-1)?.name;
    for (const entry of entries) {
      if (names.has(entry.name)) continue;
      if (last && entry.name < last) throw new Error(`Out-of-order migration: ${entry.name}`);
      await client.query('begin');
      try {
        await client.query(entry.sql);
        await client.query(
          'insert into forkcast_private.schema_migrations(name,checksum) values($1,$2)',
          [entry.name, entry.hash],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${entry.name} failed: ${error.message}`);
      }
      log(`Applied ${entry.name}`);
    }
    await client.query("notify pgrst, 'reload schema'");
    log('Forkcast schema is up to date.');
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('forkcast-schema-migrations'))");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL to the self-hosted Supabase administrator connection.');
    process.exitCode = 1;
  } else {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await migrate(client);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  }
}
