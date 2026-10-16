# Self-hosting Forkcast

Forkcast is designed to run on your own server: an exported web app plus self-hosted Supabase (Postgres, Auth, Storage, Realtime and the places Edge Function). Native iOS/Android builds can use the same backend. No Supabase Cloud project, EAS hosting account or Supabase CLI login is needed for this deployment path.

Use the [official Supabase Docker distribution](https://supabase.com/docs/guides/self-hosting/docker) rather than `supabase start` for a persistent installation. The CLI stack remains useful for local development. The examples below target **Supabase `self-hosted/v0.8.2`**, Linux, Docker Compose **2.24.4+**, and two HTTPS domains:

- `lunch.example.com`: Forkcast frontend.
- `api.lunch.example.com`: Supabase API gateway, including Auth, REST, Storage, Functions and Realtime WebSockets.

The full Supabase distribution needs approximately 4 GB RAM minimum; start with the [upstream system requirements](https://supabase.com/docs/guides/self-hosting/docker#system-requirements) and size for your users. Install Docker, Compose and Git; a host Node installation is optional when using the included images. Configure DNS and a reverse proxy with HTTPS. The examples assume the proxy runs on the same host and connects to loopback ports. For a containerized proxy, use a shared private Docker network instead of exposing the APIs publicly without TLS.

## 1. Prepare the backend

From your Forkcast checkout, record its path and prepare a **new** Supabase deployment directory:

```sh
export FORKCAST_REPO="$PWD"
git clone --depth 1 --branch self-hosted/v0.8.2 https://github.com/supabase/supabase /opt/supabase-upstream
mkdir /opt/forkcast-supabase
cp -a /opt/supabase-upstream/docker/. /opt/forkcast-supabase/
cp deploy/compose.supabase.yml /opt/forkcast-supabase/compose.forkcast.yml
cp -R supabase/functions/places supabase/functions/_shared /opt/forkcast-supabase/volumes/functions/
cd /opt/forkcast-supabase
cp .env.example .env
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
```

Review the generated `.env` using the upstream instructions. Keep this file private and retain the legacy `ANON_KEY`/`SERVICE_ROLE_KEY` environment values used by the places worker, even when clients use new publishable keys. The override is for a dedicated Forkcast stack: places authenticates each user through Auth, and verifies organization membership before accessing cached data or upstream services. The worker's legacy JWT pre-check is disabled; this does not bypass application authentication. Other functions you add must enforce their own authentication.

In the backend `.env`, configure:

```dotenv
COMPOSE_FILE=docker-compose.yml:compose.forkcast.yml
SUPABASE_PUBLIC_URL=https://api.lunch.example.com
API_EXTERNAL_URL=https://api.lunch.example.com/auth/v1
SITE_URL=https://lunch.example.com
ADDITIONAL_REDIRECT_URLS=https://lunch.example.com,forkcast://auth
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
SMTP_ADMIN_EMAIL=lunch@example.com
SMTP_HOST=YOUR_SMTP_HOST
SMTP_PORT=587
SMTP_USER=YOUR_SMTP_USER
SMTP_PASS=YOUR_SMTP_PASSWORD
SMTP_SENDER_NAME=Forkcast
OSM_USER_AGENT=Forkcast/1.0 (mailto:admin@example.com)
FORKCAST_CONFIRMATION_TEMPLATE_URL=https://lunch.example.com/auth/confirmation.html
GOOGLE_ENABLED=false
```

Use your mail server's actual SMTP settings. The web image serves the repository's confirmation template at `/auth/confirmation.html`; Auth must be able to reach that HTTPS URL when sending signup emails. This template displays the six-digit verification code expected by the app. Local Inbucket is a developer convenience, not a production mail delivery service. Self-hosted Auth is configured through environment variables rather than a Supabase Cloud dashboard or `supabase/config.toml`. See [custom email templates](https://supabase.com/docs/guides/self-hosting/custom-email-templates).

The override keeps the gateway on `127.0.0.1:8000` and removes public database pooler ports. Keep Studio/admin credentials private. The official database/storage volumes must remain persistent. Start the stack:

```sh
docker compose up -d
docker compose ps
```

## 2. Build and configure the web app

Return to your Forkcast checkout:

```sh
cd "$FORKCAST_REPO"
cp deploy/web.env.example deploy/web.env
```

Edit `deploy/web.env` with the **public** backend URL and a publishable or legacy **anon** key from your own installation. Leave Google disabled until its provider is configured. Never copy the backend `.env` into the frontend: service-role keys, database passwords, SMTP credentials and routing keys belong only on the server. The runtime generator rejects known server keys and exports only its allowlisted public settings.

```sh
docker compose -f deploy/compose.web.yml up -d --build
```

The frontend listens on `127.0.0.1:8080`. The image contains a static Expo export served by Nginx, with SPA fallback for authentication callbacks. On startup, the container writes `runtime-config.js` from `deploy/web.env` **before** the JavaScript application loads. This lets you reuse the same image for different installations without baking backend URLs/keys into it. Runtime config and HTML are not permanently cached; fingerprinted assets are cacheable. Changing public settings requires recreating the container, not rebuilding:

```sh
docker compose -f deploy/compose.web.yml up -d --force-recreate
```

Serve both domains through your existing HTTPS reverse proxy. For example, with **Caddy running on the host**:

```caddyfile
lunch.example.com {
    reverse_proxy 127.0.0.1:8080
}
api.lunch.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Caddy forwards WebSockets automatically. Other proxies must preserve Authorization/apikey headers, forward WebSocket upgrades for Realtime, and allow image uploads (at least 5 MiB) and the longer restaurant lookup timeout. Use [Supabase's proxy guide](https://supabase.com/docs/guides/self-hosting/self-hosted-proxy-https) for your proxy topology. Phones must reach the **public API domain**; Docker hostnames such as `db`, `api-gw` and `kong` are only for server-to-server traffic. An HTTP API on an HTTPS app will be blocked by browsers.

## 3. Apply Forkcast's database schema

Wait until the Supabase database, Auth and Storage services are initialized. On the Forkcast checkout:

```sh
cp deploy/migrate.env.example deploy/migrate.env
docker build -f deploy/Dockerfile.migrate -t forkcast-migrate:local .
```

Set `DATABASE_URL` in the private `deploy/migrate.env` to your own administrator connection, using an URL-encoded password. The example connects directly to `db:5432` on the official stack's `supabase_default` Docker network. Use your actual network name if you changed the upstream Compose project name.

```sh
docker run --rm --network supabase_default --env-file deploy/migrate.env forkcast-migrate:local
```

Alternatively, with Node 22.14+ and `npm ci` installed on the host:

```sh
node --env-file=deploy/migrate.env scripts/migrate.mjs
```

The runner applies pending SQL files in order, locks against simultaneous runs, wraps each file in a transaction and records checksums in the non-API `forkcast_private.schema_migrations` table. Reruns skip completed files; failures roll back the current file. It refuses changed/missing applied files and untracked existing Forkcast schemas. This is for a new self-hosted installation and its subsequent upgrades. Existing CLI-managed databases should retain their original migration workflow; do not automatically baseline production data. Do not run the test bootstrap SQL against a real Supabase database. A plain Postgres server alone is insufficient: the migrations rely on Supabase's Auth/Storage schemas, roles and Realtime publication.

## 4. Verify the installation

- `https://lunch.example.com/healthz` returns `ok`; `/runtime-config.js` contains only public configuration.
- With Google disabled, the signup screen offers email authentication without an unusable Google button.
- Create a test account, receive its verification code via SMTP, then create an organization and set its office location.
- Search for a restaurant. Check the `functions` container is running; **no interactive `supabase functions serve` terminal is required in production**.
- Join the organization from a second account/device and verify automatic updates after a vote or cooking signup.
- Upload and view a meal photo/receipt. Storage returns signed image URLs through the public API domain, with organization-scoped access policies.
- Open the frontend directly with an OAuth query string and verify the SPA loads. If you enable Google, also exercise the real callback.

Inspect errors with `docker compose logs --tail=100 functions auth rest` in the backend directory. A 503 at `/functions/v1/places` often means the functions worker did not start or its function source was not copied. The app manually validates sessions in the function, supporting your installation's signing keys through Auth's `getUser` endpoint. Preserve the upstream main worker and copy **both** `places` and `_shared`; [self-hosted functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions) are deployed by copying files and recreating the service, not `supabase functions deploy`.

## Optional Google login

Enable `GOOGLE_ENABLED=true`, fill `GOOGLE_CLIENT_ID`/`GOOGLE_SECRET` in the backend environment and set `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=true` in `deploy/web.env`. Register a Google OAuth Web client with the exact callback `https://api.lunch.example.com/auth/v1/callback`. Keep the app origin and `forkcast://auth` in the Auth redirect allowlist. Recreate Auth and the web container after changes. Google remains an external provider; email/password requires no Google setup. See [self-hosted OAuth](https://supabase.com/docs/guides/self-hosting/self-hosted-oauth).

## Map data, walking routes and external services

Self-hosting the app/backend does not automatically self-host these providers:

| Capability                            | Default                                    | Operator-managed option                                                                                                                   |
| ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Restaurant/address lookup             | Public Overpass and Nominatim              | Set `OSM_OVERPASS_URL` and `OSM_NOMINATIM_URL` on `functions`                                                                             |
| Map styles, tiles, glyphs and sprites | OpenFreeMap                                | Set the frontend's light/dark style URLs to your map service; ensure the style's referenced assets are also reachable                     |
| Walking distances/durations           | HeiGIT/openrouteservice, with a server key | Set `OPENROUTESERVICE_MATRIX_URL` to your own complete foot-walking matrix endpoint; a private keyless ORS instance needs no provider key |
| Sign-in                               | Your Auth + SMTP server                    | Optional Google OAuth remains external                                                                                                    |
| Payment links                         | PayPal.me                                  | No payment processor is hosted by Forkcast; payments/confirmations remain manually tracked                                                |

For hosted walking routes, add `OPENROUTESERVICE_API_KEY` to the backend `.env` and recreate `functions`. For your own ORS server, set the complete `OPENROUTESERVICE_MATRIX_URL` (including its foot-walking profile path) on the server. It is not accepted from app requests. Existing cache and conservative rate controls apply to both deployments. When changing routing providers, clear `public.walking_distance_cache` deliberately so old results are recalculated. Missing/unavailable routes retain the documented labelled fallback. No routing credentials belong in frontend configuration.

Outbound access is needed during image builds and the first Edge worker dependency load (npm/jsr), and for any public providers you keep. This is a self-hosted deployment path, not a fully offline distribution. Private-network deployments need reachable DNS, trusted TLS certificates and SMTP as well.

## Optional device push

See [device notification setup](device-notifications.md) for the separate background worker, VAPID keys and browser/Home Screen enrollment. Device alerts are off until a user explicitly enables them. Delivery is grouped and capped across organizations, with quiet hours, active-app suppression and conservative reminder defaults. The worker is self-hosted and needs no inbound port; browsers use their vendor's push transport.

## Upgrades and backups

Before upgrades, back up the database **and** Storage file/object data, backend configuration/signing keys and credentials, and `forkcast_private.schema_migrations`. A database dump alone does not contain uploaded image bytes. Keep encrypted backups off the server and test restoring into an isolated installation with its corresponding application version. For database exports use the [Supabase backup guidance](https://supabase.com/docs/guides/self-hosting/restore-from-platform); preserve roles/schemas needed by Auth, Storage and Realtime. Do not rotate signing keys by rerunning initial secret generation on an existing installation.

For a Forkcast upgrade:

1. Back up, fetch the chosen app revision and inspect new migrations.
2. Build the new migration image and run it against the existing database with the same command above.
3. Copy the updated `places` **and** `_shared` directories to the backend's `volumes/functions/`, then run `docker compose up -d --force-recreate functions` in the backend directory.
4. Rebuild/recreate the web container and smoke-test sign-in, search, live updates and images.

Upgrade Supabase separately using the upstream version-specific upgrade instructions, preserving your override and volumes. The supplied override targets `self-hosted/v0.8.2`; review service names, main worker behavior and environment changes before switching versions. Never use `docker compose down -v`, a development database reset or the upstream `reset.sh` as an upgrade command. Rolling the frontend back does not undo schema migrations; restore only as part of a planned database/storage recovery.

For native builds, configure the same public URL/anon key, map endpoints and optional Google flag in `.env` before building. Native app configuration is embedded at build time; web runtime configuration does not change installed binaries. MapLibre requires an installed native build rather than Expo Go. No EAS account is required when building with local Android/Xcode tooling.
