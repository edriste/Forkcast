import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import webpush from 'web-push';
import { runCycle } from './delivery.mjs';
const appOrigin = new URL(process.env.WEB_PUSH_APP_URL);
if (appOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(appOrigin.hostname))
  throw new Error('WEB_PUSH_APP_URL must use HTTPS.');
webpush.setVapidDetails(
  process.env.WEB_PUSH_SUBJECT,
  process.env.WEB_PUSH_PUBLIC_KEY,
  process.env.WEB_PUSH_PRIVATE_KEY,
);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
while (!stopping) {
  try {
    await runCycle(pool, webpush.sendNotification.bind(webpush), appOrigin.origin);
    await writeFile('/tmp/forkcast-push-heartbeat', String(Date.now()));
  } catch (error) {
    console.error(
      'Push worker cycle failed. Check database access and migrations.',
      error.code || 'configuration',
    );
  }
  for (let elapsed = 0; elapsed < 30000 && !stopping; elapsed += 1000)
    await new Promise((resolve) => setTimeout(resolve, 1000));
}
await pool.end();
