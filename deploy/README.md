# Deployment files

These files support the [self-hosted deployment](https://github.com/edriste/Forkcast/wiki/Self-hosting) and the optional [push sender](https://github.com/edriste/Forkcast/wiki/Device-notifications). The [Cloudflare PWA deployment](https://github.com/edriste/Forkcast/wiki/Cloudflare-and-Supabase) uses the root `wrangler.json` and `public/_headers` instead of these Docker/Nginx files. A Cloudflare-hosted frontend can still use the push sender separately.

| Files                                                                                                   | Purpose                                                                                       |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `compose.web.yml`, `nginx.conf`, `40-forkcast-config.sh`, `write-runtime-config.mjs`, `web.env.example` | Static web container and public runtime configuration; image defined in the root `Dockerfile` |
| `compose.supabase.yml`                                                                                  | Override for the official Supabase `self-hosted/v0.8.2` stack                                 |
| `Dockerfile.migrate`, `migrate.env.example`                                                             | One-shot database migration image running `scripts/migrate.mjs`                               |
| `compose.push.yml`, `push.env.example`, `push/`                                                         | Optional background notification sender and VAPID key generator                               |
| `package.json`, `package-lock.json`                                                                     | Small, shared Node dependency set for the migration and push images                           |

Both backend tool images use the same locked dependencies without installing Expo or running the frontend postinstall. For local push development, use `npm ci --prefix deploy`; runtime code remains in `deploy/push/`. The migration script can also run from a normal root development install as documented in the self-hosting guide.

Copy only the environment examples you need to their matching `.env` files. Filled `deploy/*.env` files are ignored by Git and excluded from Docker build contexts. The web environment contains public values only; migration and push environments contain server credentials and must stay separate.
