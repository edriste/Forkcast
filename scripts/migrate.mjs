import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const migrationsDirectory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

async function readMigrations(directory) {
  const files = (await readdir(directory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(resolve(directory, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

function pendingMigrations(entries, applied) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const row of applied) {
    if (byName.get(row.name)?.checksum !== row.checksum)
      throw new Error(`Applied migration changed or is missing: ${row.name}`);
  }
  const appliedNames = new Set(applied.map((row) => row.name));
  const lastApplied = applied.at(-1)?.name;
  return entries.filter((entry) => {
    if (appliedNames.has(entry.name)) return false;
    if (lastApplied && entry.name < lastApplied)
      throw new Error(`Out-of-order migration: ${entry.name}`);
    return true;
  });
}

async function applyMigration(client, entry) {
  await client.query('begin');
  try {
    await client.query(entry.sql);
    await client.query(
      'insert into forkcast_private.schema_migrations(name,checksum) values($1,$2)',
      [entry.name, entry.checksum],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Error(`Migration ${entry.name} failed: ${error.message}`, { cause: error });
  }
}

/** Apply Forkcast migrations to initialized Supabase, preserving its migration history. */
export async function migrate(client, directory = migrationsDirectory, log = console.log) {
  await client.query("select pg_advisory_lock(hashtext('forkcast-schema-migrations'))");
  try {
    const entries = await readMigrations(directory);
    const existing = await client.query(
      "select to_regclass('forkcast_private.schema_migrations') as history, to_regclass('public.profiles') as profiles",
    );
    if (!existing.rows[0].history && existing.rows[0].profiles)
      throw new Error(
        'Existing Forkcast schema has no deployment migration history. Keep using its original migration workflow; do not baseline an existing database automatically.',
      );
    await client.query(`
      create schema if not exists forkcast_private;
      revoke all on schema forkcast_private from public;
      create table if not exists forkcast_private.schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
      revoke all on forkcast_private.schema_migrations from public,anon,authenticated;
    `);
    const { rows: applied } = await client.query(
      'select name,checksum from forkcast_private.schema_migrations order by name',
    );
    for (const entry of pendingMigrations(entries, applied)) {
      await applyMigration(client, entry);
      log(`Applied ${entry.name}`);
    }
    await client.query("notify pgrst, 'reload schema'");
    log('Forkcast schema is up to date.');
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('forkcast-schema-migrations'))");
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('Set DATABASE_URL to the self-hosted Supabase administrator connection.');
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await migrate(client);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
