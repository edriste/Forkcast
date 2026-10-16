# Updates and backups

## Before updating

Back up the database, uploaded Storage files, backend configuration and signing keys. Include the VAPID pair if push is enabled. For Docker deployments, preserve the migration-history table too. Test recovery separately; a database dump does not include image bytes.

## Publish a release

| Component            | Supabase Cloud + Cloudflare                                                   | Docker self-hosting                                                                                        |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Database             | `npx supabase db push`                                                        | Rebuild/run the migration image from [Self-hosting](https://github.com/edriste/Forkcast/wiki/Self-hosting) |
| Restaurant function  | `npx supabase functions deploy places --no-verify-jwt`                        | Copy both `places` and `_shared` to `volumes/functions/`; recreate `functions`                             |
| Frontend             | Trigger a Cloudflare build, or `npm run build:web` then `npx wrangler deploy` | `docker compose -f deploy/compose.web.yml up -d --build`                                                   |
| Optional push worker | Restart with the new worker code                                              | Rebuild/recreate `compose.push.yml`                                                                        |

Use the installation's existing migration workflow; do not switch runners on an existing database. Keep schema changes compatible with clients that are still open.

Publish the complete web export together. The included host configuration prevents stale HTML/version checks. Users get an **Update available** prompt and reload when ready; unsaved work is not discarded automatically. Native binaries need a separate rebuild.

Upgrade Supabase separately, following its [version-specific instructions](https://supabase.com/docs/guides/self-hosting/docker#updating). Preserve volumes and credentials. Never use `docker compose down -v`, `supabase db reset` or upstream reset scripts to upgrade production.
