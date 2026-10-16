import { normalizeElement, OSM_ID, OSM_RADIUS_METERS, type Place } from './osm.ts';

type Upstream = (url: string, options?: RequestInit) => Promise<unknown>;
const types = { n: 'node', w: 'way', r: 'relation' } as const;

export function placesProvider() {
  const provider = Deno.env.get('OSM_PLACES_PROVIDER')?.trim() || 'overpass';
  if (provider !== 'overpass' && provider !== 'geoapify')
    throw new Error('Restaurant search provider is not configured correctly.');
  return provider;
}

function endpoint(path: string) {
  const key = Deno.env.get('GEOAPIFY_API_KEY')?.trim();
  if (!key)
    throw new Error(
      'Restaurant search needs a Geoapify API key. Ask your administrator to configure it.',
    );
  const url = new URL(`https://api.geoapify.com/v2/${path}`);
  url.searchParams.set('apiKey', key);
  return url;
}

/** Keep original OSM IDs so reviews, favorites and editor links remain valid. */
export function normalizeGeoapify(feature: unknown, updatedAt: string): Place | null {
  if (!feature || typeof feature !== 'object' || !('properties' in feature)) return null;
  const properties = feature.properties as Record<string, unknown> | null;
  if (!properties || typeof properties !== 'object') return null;
  const source = properties.datasource as
    { sourcename?: string; raw?: Record<string, unknown> } | undefined;
  if (source?.sourcename !== 'openstreetmap' || !source.raw) return null;
  const raw = source.raw;
  const type = types[raw.osm_type as keyof typeof types];
  if (!type) return null;
  const tags = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  for (const field of ['name', 'website', 'opening_hours'])
    if (!tags[field] && typeof properties[field] === 'string') tags[field] = properties[field];
  for (const [tag, field] of Object.entries({
    'addr:street': 'street',
    'addr:housenumber': 'housenumber',
    'addr:postcode': 'postcode',
    'addr:city': 'city',
  }))
    if (!tags[tag] && typeof properties[field] === 'string') tags[tag] = properties[field];
  const place = normalizeElement(
    {
      type,
      id: Number(raw.osm_id),
      lat: properties.lat as number,
      lon: properties.lon as number,
      tags,
    },
    updatedAt,
  );
  return place ? { ...place, dataSource: 'geoapify' } : null;
}

function features(data: unknown): unknown[] {
  if (!data || typeof data !== 'object' || !('features' in data) || !Array.isArray(data.features))
    throw new Error('Geoapify returned an incomplete restaurant response. Please try again later.');
  return data.features;
}

// Sequential pages stay below the free plan's 5 requests/second limit. Callers
// also claim a project-wide gate and refresh lease before entering this module.
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 250));

export async function discoverGeoapify(latitude: number, longitude: number, upstream: Upstream) {
  const url = endpoint('places');
  url.searchParams.set(
    'categories',
    'catering.restaurant,catering.cafe,catering.fast_food,catering.food_court,commercial.food_and_drink.bakery',
  );
  url.searchParams.set('filter', `circle:${longitude},${latitude},${OSM_RADIUS_METERS}`);
  url.searchParams.set('bias', `proximity:${longitude},${latitude}`);
  url.searchParams.set('limit', '500');
  const updatedAt = new Date().toISOString();
  const places = new Map<string, Place>();
  const signal = AbortSignal.timeout(55000);
  // Bound both latency and credit usage. Never silently save a truncated area.
  for (let page = 0; page < 8; page++) {
    if (page) await pause();
    url.searchParams.set('offset', String(page * 500));
    const rows = features(await upstream(url.toString(), { signal }));
    if (rows.length > 500)
      throw new Error(
        'Geoapify returned an incomplete restaurant response. Please try again later.',
      );
    for (const row of rows) {
      const place = normalizeGeoapify(row, updatedAt);
      if (place) places.set(place.id, place);
    }
    if (rows.length < 500) {
      if (rows.length && !places.size)
        throw new Error(
          'Geoapify returned no supported OpenStreetMap restaurants. Ask your administrator to check the provider response.',
        );
      return [...places.values()];
    }
  }
  throw new Error(
    'The restaurant area is too large to load completely. Saved places have been kept.',
  );
}

export async function refreshGeoapify(ids: string[], upstream: Upstream) {
  const url = endpoint('place-details');
  url.searchParams.set('features', 'details');
  const signal = AbortSignal.timeout(55000);
  const places: Place[] = [];
  let requests = 0;
  for (const id of ids) {
    if (!OSM_ID.test(id)) continue;
    if (requests++) await pause();
    const [, type, number] = id.split(':');
    url.searchParams.set('osm_type', type[0]);
    url.searchParams.set('osm_id', number);
    for (const row of features(await upstream(url.toString(), { signal }))) {
      const place = normalizeGeoapify(row, new Date().toISOString());
      if (place?.id === id) places.push(place);
    }
  }
  return places;
}
