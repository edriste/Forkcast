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

If creating an organization fails with `organizations_created_by_fkey`, the signed-in account has no application profile. This can happen when an account was created before the database schema was installed. Apply the latest migrations with `npx supabase db push --linked`, including `202610160043_backfill_profiles.sql`, then retry organization creation. The migration creates missing profiles from existing Auth users while preserving existing profile names. It requires no account deletion, Edge Function deployment or Cloudflare rebuild.

If organization address search reports an OpenStreetMap error, inspect **Supabase → Edge Functions → places → Logs**. Current function code logs `OSM upstream request failed` with the provider hostname and HTTP status, without the address query or upstream response body. A 401/403 is a provider rejection, 429 is rate limiting, and 5xx indicates an upstream failure. Confirm `OSM_USER_AGENT` includes a real operator contact and that any `OSM_NOMINATIM_URL` override points to a compatible Nominatim search endpoint (the default already includes `/search`). A valid identifier does not guarantee acceptance by the public provider. Deploy function changes with `npx supabase functions deploy places --no-verify-jwt`; a frontend-only Wrangler deployment does not update this backend code.

By default, restaurant discovery uses Overpass, independently of the office-address geocoder. Its area query supplies a small indexed bounding box alongside the 3 km radius filter; near poles or across the date line it uses the radius filter alone. A failed initial area refresh imposes a one-minute retry cooldown; an interrupted worker can leave a lease for up to two minutes. The function distinguishes the cooldown from an active refresh and retains saved results when available. Logs include `OSM upstream request started/completed` (host and elapsed time), `OSM upstream connection failed` (timeout or connection/response failure), `OSM restaurant response incomplete` and `OSM area refresh deferred`. Queries, keys and response bodies are omitted. A shutdown reason of `EarlyDrop` alone is normal, as described in [Supabase's shutdown documentation](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained); it does not diagnose an upstream failure. For repeated Overpass HTTP failures, check the configured `OSM_OVERPASS_URL` and that provider's availability. Redeploy the backend to get these diagnostics; a Wrangler deployment alone will not update them.

If the public Nominatim service rejects your hosted function, an alternative is the [openrouteservice geocoder](https://giscience.github.io/openrouteservice/api-reference/endpoints/geocoder/). In **Supabase → Edge Functions → Secrets**, set:

```dotenv
OSM_GEOCODING_PROVIDER=openrouteservice
OPENROUTESERVICE_API_KEY=YOUR_EXISTING_ORS_KEY
```

Then deploy the updated `places` function. The key must have geocoding access; its Matrix access alone does not prove geocoding is enabled. Address search uses the hosted Pelias endpoint at `https://api.heigit.org/pelias/v1/search`, with the key in the Authorization header. Geocoding requests use that key's separate provider allowance; the app's 400/day Matrix reservation cap applies only to walking routes. Lookups remain explicit, globally spaced by at least 1.1 seconds and cached for 30 days. Provider-specific cache keys prevent an old Nominatim result from masking the switch. Office selection, compact address labels and legacy-area lookup work with either provider. Restaurant discovery uses the separately configured places provider (Overpass by default), and maps still use OpenFreeMap; no Google Places key is used.

The provider defaults to `nominatim`. Switching to openrouteservice is explicit: there is no automatic retry against another provider on errors or missing credentials. A private/self-hosted ORS Matrix endpoint does not include a Pelias geocoder. Set `OSM_GEOCODING_PROVIDER=nominatim` to return to your configured Nominatim endpoint. Credits for the optional geocoder appear in the existing credits dialog; deploy the frontend changes to include those credits and German error translations. The address-search integration itself only requires the backend deployment and secrets; no new database migration is needed.

## Geoapify restaurant search

If public Overpass cannot be reached from your hosted function, select Geoapify instead. This changes restaurant discovery and saved-place fact refreshes; office address search and walking routes keep their existing providers.

1. Create a free account and project at [Geoapify MyProjects](https://myprojects.geoapify.com/), then copy its API key.
2. In **Supabase → Edge Functions → Secrets**, save both server-only values:

   ```dotenv
   OSM_PLACES_PROVIDER=geoapify
   GEOAPIFY_API_KEY=YOUR_GEOAPIFY_KEY
   ```

   Do not put the key in Cloudflare frontend variables or use an `EXPO_PUBLIC_` prefix. The requests originate on Supabase, so browser-only referrer restrictions will not authorize them; Supabase does not provide fixed outbound IPs for an IP allowlist.

3. From the checkout containing this implementation, deploy the backend:

   ```sh
   npx supabase functions deploy places --project-ref YOUR_PROJECT_REF --no-verify-jwt
   ```

   The function still validates the signed-in session and organization membership itself.

4. Build/deploy the frontend as usual so it includes Geoapify attribution. A backend deployment alone does not publish those UI changes.
5. Open **Places → Add a lunch spot** and search for a nearby restaurant. Logs should show requests to `api.geoapify.com`, not `overpass-api.de`. Opening an older saved place should also refresh through Geoapify. A provider switch invalidates the discovery snapshot automatically; no SQL edits or cache deletion are needed. An existing retry cooldown/lease can still last one/two minutes.

Original `osm:node/way/relation` identifiers are preserved, so reviews, favorites, nominations and team cuisine corrections remain attached. Returned records without usable OSM identity or supported food tags are omitted. Geoapify has its own OSM import schedule: edits made on OSM are not guaranteed to appear immediately.

Discovery remains shared per organization for 30 days. Pages contain up to 500 results, fetched sequentially with 250 ms spacing, a 55-second overall provider deadline and a limit of eight pages. If the area cannot be loaded completely, the previous catalogue is retained rather than replaced with a truncated one. Fact refreshes use Geoapify's exact-OSM-ID details endpoint, request only `details`, and process at most ten stale places per request; remaining places are checked on later loads. Existing database leases, the shared restaurant gate and per-place cooldowns also apply. There is no automatic Overpass fallback.

The [free plan](https://www.geoapify.com/pricing/) currently provides 3,000 credits/day, with no credit card required. [Places API credits](https://apidocs.geoapify.com/docs/places/) depend on result count (one credit per 20 places); detail requests have a separate credit cost. These safeguards reduce consumption but are not a daily account quota enforcement mechanism. Other applications using the account also consume its allowance. Stay on the free plan and monitor the Geoapify dashboard. Quota limits are soft; persistent excess may result in an upgrade request or restriction.

Geoapify permits caching with required source attribution. Forkcast records Geoapify provenance in each imported place and displays a linked **Powered by Geoapify** alongside OSM attribution in views using those records, including the map. See the [Places API documentation](https://apidocs.geoapify.com/docs/places/), [details API](https://apidocs.geoapify.com/docs/place-details/) and [storage/attribution FAQ](https://www.geoapify.com/places-api/).

To revert, set `OSM_PLACES_PROVIDER=overpass`. No Google credentials or database migration are required for either provider.
