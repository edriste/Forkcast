# Deploying Forkcast on Cloudflare Workers

This deployment serves Forkcast's static PWA through Workers Static Assets. Supabase remains the backend; this does not deploy database migrations, the `places` Edge Function or the optional push sender.

Connect your Git repository in Workers & Pages. Use these values on the setup screen:

| Field           | Value                                         |
| --------------- | --------------------------------------------- |
| Project name    | `forkcast`                                    |
| Build command   | `npm run build:web`                           |
| Deploy command  | `npx wrangler deploy`                         |
| Preview command | `npx wrangler versions upload`                |
| Path            | `/`                                           |
| API token       | Allow Cloudflare to create a deployment token |

The checked-in `wrangler.json` supplies the project name, compatibility date, `dist` directory and SPA fallback for links/auth callbacks. The earlier commands with `--name forkcast --assets ./dist` still work with this configuration. Cloudflare requires a [compatibility date](https://developers.cloudflare.com/workers/configuration/compatibility-dates/); keep it pinned and change it deliberately when upgrading runtime behavior.

Add these **build variables** in the project's build settings before building:

```dotenv
NODE_VERSION=22.14.0
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

Set Google to `true` only after its provider has been configured in Supabase. Optional `EXPO_PUBLIC_WEB_PUSH_KEY` is the public VAPID key. These values are embedded into the frontend at build time, so changing them requires a new build. Worker runtime bindings/secrets alone do not configure an already exported app. Never put a database password, Supabase service-role key, SMTP credentials, ORS key or private VAPID key into frontend build variables.

For a **local** `npm run build:web` followed by `npx wrangler deploy`, set the hosted project's URL/public key in your local `.env.production.local` (ignored by Git). Cloudflare build variables are not downloaded into a local build. Keep `.env.local` from overriding those values, and check that your shell does not already export different values. The web build clears Metro's transform cache so browser-test configuration cannot leak into a subsequent production export. The `forkcast-test.supabase.co` URL in `test:ui:build` is intentional test infrastructure; do not replace it with production credentials. After correcting settings, build again and reload the deployed app to receive the new bundle.

Commit and push the configuration and current app code, then retry deployment against that revision. Once a production URL exists, configure Supabase Auth's Site URL and allowed redirect URLs for it. Do not use a temporary preview URL as the production Site URL.

`npm run build:web` copies `public/_headers` into the export. Cloudflare applies these [static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/) to keep the release document and runtime settings uncached, revalidate the service worker/manifest and cache hashed bundles. The separate Nginx configuration applies only to Docker hosting. No custom Cloudflare Worker script is needed for the frontend.

Check the deployed `/version.json` returns JSON with `Cache-Control: no-store`, `/service-worker.js` returns JavaScript, and an `/auth/callback` navigation reaches the app. Then test sign-in, maps and the update prompt. The Cloudflare frontend does not start the [device push sender](device-notifications.md); it must run separately, connected to your actual Supabase database.

If organization address search reports an OpenStreetMap error, inspect **Supabase → Edge Functions → places → Logs**. Current function code logs `OSM upstream request failed` with the provider hostname and HTTP status, without the address query or upstream response body. A 401/403 is a provider rejection, 429 is rate limiting, and 5xx indicates an upstream failure. Confirm `OSM_USER_AGENT` includes a real operator contact and that any `OSM_NOMINATIM_URL` override points to a compatible Nominatim search endpoint (the default already includes `/search`). A valid identifier does not guarantee acceptance by the public provider. Deploy function changes with `npx supabase functions deploy places --no-verify-jwt`; a frontend-only Wrangler deployment does not update this backend code.

If the public Nominatim service rejects your hosted function, an alternative is the [openrouteservice geocoder](https://giscience.github.io/openrouteservice/api-reference/endpoints/geocoder/). In **Supabase → Edge Functions → Secrets**, set:

```dotenv
OSM_GEOCODING_PROVIDER=openrouteservice
OPENROUTESERVICE_API_KEY=YOUR_EXISTING_ORS_KEY
```

Then deploy the updated `places` function. The key must have geocoding access; its Matrix access alone does not prove geocoding is enabled. Address search uses the hosted Pelias endpoint at `https://api.heigit.org/pelias/v1/search`, with the key in the Authorization header. Geocoding requests use that key's separate provider allowance; the app's 400/day Matrix reservation cap applies only to walking routes. Lookups remain explicit, globally spaced by at least 1.1 seconds and cached for 30 days. Provider-specific cache keys prevent an old Nominatim result from masking the switch. Office selection, compact address labels and legacy-area lookup work with either provider. Restaurant discovery still uses Overpass and maps still use OpenFreeMap; no Google Places key is used.

The provider defaults to `nominatim`. Switching to openrouteservice is explicit: there is no automatic retry against another provider on errors or missing credentials. A private/self-hosted ORS Matrix endpoint does not include a Pelias geocoder. Set `OSM_GEOCODING_PROVIDER=nominatim` to return to your configured Nominatim endpoint. Credits for the optional geocoder appear in the existing credits dialog; deploy the frontend changes to include those credits and German error translations. The address-search integration itself only requires the backend deployment and secrets; no new database migration is needed.
