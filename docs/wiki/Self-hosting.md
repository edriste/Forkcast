# Self-hosting

Run the web app and Supabase on your own Linux server with Docker Compose 2.24.4+. You need two HTTPS domains, SMTP and persistent storage. Use the [official Supabase requirements](https://supabase.com/docs/guides/self-hosting/docker#system-requirements) to size the server.

These instructions target **Supabase `self-hosted/v0.8.2`**, the version supported by Forkcast's Compose override. Follow that version's setup rather than replacing it with the latest upstream release without review.

## 1. Prepare Supabase

From the Forkcast checkout, create a new backend installation:

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

Retain the generated credentials, including `ANON_KEY` and `SERVICE_ROLE_KEY` used by the function. In the backend `.env`, set:

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
FORKCAST_CONFIRMATION_TEMPLATE_URL=https://lunch.example.com/auth/confirmation.html
OSM_USER_AGENT=Forkcast/1.0 (mailto:admin@example.com)
GOOGLE_ENABLED=false
```

Add any [location-provider settings](https://github.com/edriste/Forkcast/wiki/Maps-and-location), then start the backend:

```sh
docker compose up -d
```

Keep the backend environment private. Preserve the upstream main function worker; the override disables its JWT pre-check because Forkcast validates sessions and membership inside `places`. Other functions must enforce their own authentication.

## 2. Start the web app

```sh
cd "$FORKCAST_REPO"
cp deploy/web.env.example deploy/web.env
```

Set the public API URL and publishable/anon key in `deploy/web.env`, then run:

```sh
docker compose -f deploy/compose.web.yml up -d --build
```

Only public values belong in this file. The container reads them at startup; after changing them, recreate it with `--force-recreate`.

## 3. Add HTTPS

Point both domains at the server. For Caddy running on the host:

```caddyfile
lunch.example.com {
    reverse_proxy 127.0.0.1:8080
}
api.lunch.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Other proxies must support Realtime WebSockets, image uploads of at least 5 MiB and restaurant requests lasting up to a minute. The Auth service must be able to fetch the public confirmation template. Keep Studio and database ports private.

## 4. Apply the schema

Wait for the backend services to initialize. From the Forkcast checkout:

```sh
cp deploy/migrate.env.example deploy/migrate.env
docker build -f deploy/Dockerfile.migrate -t forkcast-migrate:local .
```

Set `DATABASE_URL` in `deploy/migrate.env` to an administrator connection, with special password characters URL-encoded. The example uses `db:5432` on the `supabase_default` Docker network. Then run:

```sh
docker run --rm --network supabase_default --env-file deploy/migrate.env forkcast-migrate:local
```

Use your actual network name if different. The runner records applied migrations and checksums; keep using it for this installation. Existing CLI-managed databases must retain their original workflow. Plain Postgres is insufficient: the schema requires Supabase Auth, Storage and Realtime.

## 5. Check it works

Open the app, verify an email signup, create a team and search for a restaurant. Use a second account to check live updates, and upload a meal photo to check Storage. `/healthz` should return `ok`.

Next: [Google login](https://github.com/edriste/Forkcast/wiki/Authentication), [optional push](https://github.com/edriste/Forkcast/wiki/Device-notifications), and [updates and backups](https://github.com/edriste/Forkcast/wiki/Maintenance). Self-hosting still uses external map/location services unless you replace them.
