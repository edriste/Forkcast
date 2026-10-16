import { normalizeLocations, normalizePeliasLocations } from './location.ts';

type Upstream = (url: string, options?: RequestInit) => Promise<unknown>;

export function geocodingProvider() {
  const provider = Deno.env.get('OSM_GEOCODING_PROVIDER')?.trim() || 'nominatim';
  if (provider !== 'nominatim' && provider !== 'openrouteservice')
    throw new Error('Location search provider is not configured correctly.');
  return provider;
}

/** Callers authenticate, claim the shared address gate and cache normalized results. */
export async function geocode(query: string, limit: number, upstream: Upstream) {
  if (geocodingProvider() === 'openrouteservice') {
    const key = Deno.env.get('OPENROUTESERVICE_API_KEY')?.trim();
    if (!key)
      throw new Error(
        'Location search needs an openrouteservice API key. Ask your administrator to configure it.',
      );
    const url = new URL('https://api.heigit.org/openrouteservice/geocode/search');
    url.searchParams.set('text', query);
    url.searchParams.set('size', String(limit));
    // Keep credentials out of URLs, logs and the public client configuration.
    return normalizePeliasLocations(
      await upstream(url.toString(), { headers: { Authorization: key } }),
    ).slice(0, limit);
  }
  const url = new URL(
    Deno.env.get('OSM_NOMINATIM_URL') || 'https://nominatim.openstreetmap.org/search',
  );
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));
  return normalizeLocations(await upstream(url.toString())).slice(0, limit);
}
