# Maps and location

Restaurant discovery, office-address lookup, map tiles and walking routes are separate services. Configure provider secrets in **Supabase → Edge Functions → Secrets**, or in the self-hosted backend's environment. Never put private provider keys in `EXPO_PUBLIC_` variables.

## Restaurants: Geoapify or Overpass

For Geoapify, create a project at [MyProjects](https://myprojects.geoapify.com/) and save:

```dotenv
OSM_PLACES_PROVIDER=geoapify
GEOAPIFY_API_KEY=YOUR_KEY
```

Deploy the `places` function and the frontend attribution changes. On Docker, recreate `functions` after updating its environment.

Geoapify uses OSM data and preserves Forkcast's existing restaurant IDs, reviews and favorites. Switching providers refreshes the discovery cache automatically. Public OSM edits follow the provider's import schedule.

The keyless default is `OSM_PLACES_PROVIDER=overpass`. It uses public Overpass, which may reject or time out on hosted networks. Identify the app with `OSM_USER_AGENT="Forkcast/1.0 (mailto:admin@example.com)"`; an operator-managed endpoint can be set with `OSM_OVERPASS_URL`.

Restaurant discovery covers 3 km around the office and is cached for 30 days. Older saved details are checked separately. Failed refreshes keep saved data. Geoapify's free allowance is limited; check its [current pricing](https://www.geoapify.com/pricing/) and account usage. Forkcast does not enforce a daily Geoapify account budget.

## Office-address lookup

Nominatim is the default, with explicit searches rather than autocomplete. To use openrouteservice instead:

```dotenv
OSM_GEOCODING_PROVIDER=openrouteservice
OPENROUTESERVICE_API_KEY=YOUR_ORS_KEY
```

Obtain the key at [HeiGIT](https://account.heigit.org/) and enable geocoding access. A Matrix-only key is insufficient. This setting changes office lookup independently of restaurant search.

## Walking time and distance

Enable Matrix access on the same `OPENROUTESERVICE_API_KEY` to calculate walks from the office. Forkcast caches routes and limits requests to 400 per rolling 24 hours; the provider's own account limits still apply. Moving the office invalidates its routes.

Without routing, the app labels straight-line estimates. No phone location permission is needed. For your own routing server, set `OPENROUTESERVICE_MATRIX_URL` to its complete foot-walking matrix endpoint. When changing routing providers, clear only `public.walking_distance_cache` so routes are recalculated.

## Maps and attribution

OpenFreeMap tiles and MapLibre are used by default. Optional frontend overrides are `EXPO_PUBLIC_OSM_MAP_STYLE_URL` and `EXPO_PUBLIC_OSM_DARK_MAP_STYLE_URL`.

Keep the app's provider credits and map attribution visible. Cuisine corrections stay private to the organization unless someone publishes an edit through OpenStreetMap.
