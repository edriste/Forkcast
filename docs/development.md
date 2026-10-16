# Development

Use Node **22.14+**, npm, Docker and the Supabase CLI. Run commands from the repository root.

## Start locally

```sh
npm ci
cp .env.example .env
cp supabase/.env.example supabase/.env.local
```

For email-only development, set `[auth.external.google].enabled = false` in `supabase/config.toml` before starting. The checked-in configuration currently enables Google and therefore needs credentials if left unchanged.

```sh
npx supabase start
npx supabase migration up --local
npx supabase status
```

Copy the local API URL and public publishable/anon key into `.env`. Never use a service-role key in the frontend. Fill optional provider keys in `supabase/.env.local` using the [provider guide](https://github.com/edriste/Forkcast/wiki/Maps-and-location).

In separate terminals:

```sh
npx supabase functions serve places --env-file supabase/.env.local --no-verify-jwt
```

```sh
npm run web
```

Studio: `http://127.0.0.1:54323`. Signup email codes: `http://127.0.0.1:54324`. Restart Expo after changing frontend environment values.

For local Google OAuth, fill the server credentials in `supabase/.env.local`, export them before starting Supabase, and enable the Google provider. Register `http://127.0.0.1:54321/auth/v1/callback` in Google; allow the actual Expo web URL in Supabase Auth. See [authentication](https://github.com/edriste/Forkcast/wiki/Authentication).

## Native builds

MapLibre requires an installed build rather than Expo Go. Android needs Android Studio; iOS needs macOS and Xcode.

```sh
npx expo prebuild --platform android
npx expo run:android
```

On macOS, use `ios` in place of `android`. Use a backend address reachable by the device: Android emulators use `10.0.2.2` instead of `127.0.0.1`; physical phones need the computer's LAN address. Native configuration changes require rebuilding.

## Checks

```sh
npm run check
npm run edge:check
npm run edge:test
npm run format:check
```

For browser checks:

```sh
npm run test:ui:build
npx playwright install chromium
npm run test:ui
```

The browser build uses fake credentials and is written to `/tmp/forkcast-test-web`; do not deploy it. `FORKCAST_CHROMIUM_PATH` can select an existing Chromium binary. Python 3 serves the test app.

Optional concurrency checks need a disposable PostgreSQL server:

```sh
docker run --name forkcast-test-db --rm -d \
  -e POSTGRES_PASSWORD=forkcast-test-only \
  -p 127.0.0.1:55439:5432 postgres:17-alpine
FORKCAST_TEST_DATABASE_URL=postgres://postgres:forkcast-test-only@127.0.0.1:55439/postgres npm run test:postgres
docker stop forkcast-test-db
```

Wait for PostgreSQL to accept connections first. Never point these tests at an app database. After a deployment, check sign-in, restaurant search and live updates with two accounts; test push on consenting devices if enabled. Keep current test results in pull requests rather than appending a permanent verification log.
