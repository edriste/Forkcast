import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizeLocations } from '../_shared/location.ts';
import { applyCuisineOverride, type CuisineOverride } from '../_shared/cuisines.ts';
import {
  CACHE_DAYS,
  OSM_ID,
  OSM_RADIUS_METERS,
  legacyPlace,
  normalizeElement,
  searchPlaces,
  type OSMElement,
  type Place,
} from '../_shared/osm.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const userAgent =
  Deno.env.get('OSM_USER_AGENT') ?? 'Forkcast/1.0 (internal colleague lunch planner)';
type Region = {
  area_query: string;
  latitude: number | null;
  longitude: number | null;
  places: Place[];
  refreshed_at: string | null;
};
async function loadCuisineOverrides(client: SupabaseClient, org: string, ids?: string[]) {
  const overrides = new Map<string, CuisineOverride>();
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from('place_cuisine_overrides')
      .select('place_id,cuisines,updated_at')
      .eq('organization_id', org)
      .order('place_id')
      .range(offset, offset + 499);
    if (ids) query = query.in('place_id', ids);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data)
      overrides.set(row.place_id, { cuisines: row.cuisines, updatedAt: row.updated_at });
    if (data.length < 500) break;
  }
  return overrides;
}
async function upstream(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(40000),
    headers: { ...options.headers, 'User-Agent': userAgent, Accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error('OpenStreetMap lookup is busy or unavailable. Please try again later.');
  return response.json();
}
async function getRegion(
  client: SupabaseClient,
  admin: SupabaseClient,
  org: { id: string; search_area: string; latitude?: number | null; longitude?: number | null },
) {
  const cached = await client
    .from('osm_region_cache')
    .select('area_query,latitude,longitude,places,refreshed_at')
    .eq('organization_id', org.id)
    .maybeSingle();
  if (cached.error) throw cached.error;
  const previous = cached.data as Region | null;
  const reusable = previous?.area_query === org.search_area ? previous : null;
  if (
    reusable?.refreshed_at &&
    Date.parse(reusable.refreshed_at) > Date.now() - CACHE_DAYS * 86400000
  )
    return { region: reusable, warning: '' };
  const lease = await admin.rpc('claim_osm_refresh', { org: org.id, area: org.search_area });
  if (lease.error) throw lease.error;
  if (!lease.data) {
    if (reusable?.refreshed_at)
      return {
        region: reusable,
        warning: 'Showing saved OSM data while the area refresh is pending. Try again later.',
      };
    throw new Error('Your area is being loaded or is waiting to retry. Please try again shortly.');
  }
  try {
    let latitude = org.latitude ?? reusable?.latitude;
    let longitude = org.longitude ?? reusable?.longitude;
    if (
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined
    ) {
      const gate = await admin.rpc('claim_osm_request', { service_name: 'nominatim' });
      if (gate.error || !gate.data) throw new Error('Area lookup is busy. Please try again later.');
      const url = new URL(
        Deno.env.get('OSM_NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org/search',
      );
      url.searchParams.set('q', org.search_area);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      const matches = await upstream(url.toString());
      if (!Array.isArray(matches) || !matches.length)
        throw new Error(
          'The search area could not be found. Use a specific neighborhood, city and country when creating the group.',
        );
      latitude = Number(matches[0].lat);
      longitude = Number(matches[0].lon);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      )
        throw new Error('The area lookup returned an invalid location.');
    }
    const gate = await admin.rpc('claim_osm_request', { service_name: 'overpass' });
    if (gate.error || !gate.data)
      throw new Error('Restaurant lookup is busy. Please try again later.');
    const around = `around:${OSM_RADIUS_METERS},${latitude},${longitude}`;
    const query = `[out:json][timeout:25][maxsize:16777216];(nwr(${around})["amenity"~"^(restaurant|cafe|fast_food|food_court)$"];nwr(${around})["shop"="bakery"];);out center tags;`;
    const data = await upstream(
      Deno.env.get('OSM_OVERPASS_URL') ?? 'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
      },
    );
    // Overpass can report failures inside an HTTP 200 response. Never replace good data with a partial result.
    if (!Array.isArray(data.elements) || data.remark)
      throw new Error('Restaurant lookup did not complete. Please try again later.');
    const refreshedAt = new Date().toISOString();
    const places = [
      ...new Map(
        (data.elements as OSMElement[])
          .map((element) => normalizeElement(element, refreshedAt))
          .filter((place): place is Place => place !== null)
          .map((place) => [place.id, place]),
      ).values(),
    ];
    for (let i = 0; i < places.length; i += 200) {
      const saved = await admin.from('places').upsert(
        places.slice(i, i + 200).map((place) => ({
          id: place.id,
          provider: 'osm',
          metadata: place,
          refreshed_at: refreshedAt,
        })),
      );
      if (saved.error) throw saved.error;
    }
    const region = {
      area_query: org.search_area,
      latitude,
      longitude,
      places,
      refreshed_at: refreshedAt,
    };
    const saved = await admin
      .from('osm_region_cache')
      .update({ ...region, lease_until: null, lease_token: null, retry_after: null })
      .eq('organization_id', org.id)
      .eq('lease_token', lease.data)
      .select('organization_id')
      .single();
    if (saved.error) throw saved.error;
    return { region, warning: '' };
  } catch (error) {
    await admin
      .from('osm_region_cache')
      .update({
        lease_until: null,
        lease_token: null,
        retry_after: new Date(Date.now() + 60000).toISOString(),
      })
      .eq('organization_id', org.id)
      .eq('lease_token', lease.data);
    const warning = error instanceof Error ? error.message : 'OSM data could not be refreshed.';
    if (reusable?.refreshed_at)
      return { region: reusable, warning: `Showing saved OSM data. ${warning}` };
    throw new Error(warning);
  }
}

async function refreshPlaceFacts(
  admin: SupabaseClient,
  available: Map<string, Place>,
  force: boolean,
  automatic = false,
) {
  const ids = [...available.values()]
    .filter(
      (place) =>
        place.provider === 'osm' &&
        OSM_ID.test(place.id) &&
        (force || !place.updatedAt || !(Date.parse(place.updatedAt) > Date.now() - 86400000)),
    )
    .map((place) => place.id);
  if (!ids.length) return '';
  const { data: leases, error } = await admin.rpc('claim_osm_place_refresh', {
    ids,
    force_refresh: force,
  });
  if (error) throw error;
  if (!leases.length)
    return force && !automatic
      ? 'OSM data was checked recently or is refreshing. Try again in a few minutes.'
      : '';
  const batch = leases[0].token;
  try {
    const gate = await admin.rpc('claim_osm_request', { service_name: 'overpass' });
    if (gate.error) throw gate.error;
    if (!gate.data) throw new Error('Restaurant lookup is busy. Please try again later.');
    const selectors = leases
      .map(({ place_id }: { place_id: string }) => {
        const [, type, id] = place_id.split(':');
        return `${type}(${id});`;
      })
      .join('');
    const data = await upstream(
      Deno.env.get('OSM_OVERPASS_URL') ?? 'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          data: `[out:json][timeout:25][maxsize:16777216];(${selectors});out center tags;`,
        }).toString(),
      },
    );
    if (!Array.isArray(data.elements) || data.remark)
      throw new Error('Restaurant lookup did not complete. Please try again later.');
    const wanted = new Set(leases.map((row: { place_id: string }) => row.place_id));
    const updatedAt = new Date().toISOString();
    const places = (data.elements as OSMElement[])
      .map((element) => normalizeElement(element, updatedAt))
      .filter((place): place is Place => !!place && wanted.has(place.id));
    const saved = await admin.rpc('finish_osm_place_refresh', {
      batch,
      updates: places,
      succeeded: true,
    });
    if (saved.error) throw saved.error;
    for (const place of places) available.set(place.id, place);
    return wanted.size > places.length
      ? 'Some places were not returned by OSM. Their saved details have been kept.'
      : '';
  } catch (error) {
    await admin.rpc('finish_osm_place_refresh', { batch, updates: [], succeeded: false });
    return `Showing saved OSM data. ${error instanceof Error ? error.message : 'OSM data could not be refreshed.'}`;
  }
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Use POST' }, 405);
  try {
    const token = request.headers.get('Authorization');
    if (!token?.startsWith('Bearer ')) return reply({ error: 'Sign in first' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: token } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return reply({ error: 'Sign in first' }, 401);
    const body = await request.json();
    // Selecting an office location happens before a user has a group.
    if (body.action === 'locations') {
      if (typeof body.query !== 'string' || body.query.trim().length < 3 || body.query.length > 160)
        return reply({ error: 'Enter an address between 3 and 160 characters.' }, 400);
      const query = body.query.trim().replace(/\s+/g, ' ');
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const cached = await admin
        .from('osm_location_cache')
        .select('locations,refreshed_at')
        .eq('query', query.toLowerCase())
        .maybeSingle();
      if (cached.error) throw cached.error;
      if (cached.data && Date.parse(cached.data.refreshed_at) > Date.now() - CACHE_DAYS * 86400000)
        return reply({ locations: cached.data.locations });
      const gate = await admin.rpc('claim_osm_request', { service_name: 'nominatim' });
      if (gate.error) throw gate.error;
      if (!gate.data)
        return reply({ error: 'Location lookup is busy. Please try again shortly.' }, 429);
      const url = new URL(
        Deno.env.get('OSM_NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org/search',
      );
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      const locations = normalizeLocations(await upstream(url.toString()));
      const saved = await admin
        .from('osm_location_cache')
        .upsert({ query: query.toLowerCase(), locations, refreshed_at: new Date().toISOString() });
      if (saved.error) throw saved.error;
      return reply({ locations });
    }
    if (typeof body.organizationId !== 'string')
      return reply({ error: 'Select an organization' }, 400);
    const { data: org } = await client
      .from('organizations')
      .select('id,search_area,latitude,longitude')
      .eq('id', body.organizationId)
      .single();
    if (!org) return reply({ error: 'Organization access denied' }, 403);
    if (body.action === 'search') {
      if (typeof body.query !== 'string' || body.query.trim().length < 2 || body.query.length > 160)
        return reply({ error: 'Enter a search between 2 and 160 characters' }, 400);
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { region, warning } = await getRegion(client, admin, org);
      const overrides = await loadCuisineOverrides(client, org.id);
      return reply({
        places: searchPlaces(
          region.places.map((place) => applyCuisineOverride(place, overrides.get(place.id))),
          body.query,
        ),
        warning,
        refreshedAt: region.refreshed_at,
        radiusMeters: OSM_RADIUS_METERS,
      });
    }
    if (body.action === 'details') {
      if (
        !Array.isArray(body.ids) ||
        body.ids.length < 1 ||
        body.ids.length > 100 ||
        body.ids.some((id: unknown) => typeof id !== 'string' || id.length > 255) ||
        (body.refresh !== undefined && typeof body.refresh !== 'boolean') ||
        (body.automatic !== undefined && typeof body.automatic !== 'boolean')
      )
        return reply({ error: 'Invalid place identifiers' }, 400);
      // Vouch for every ID through selected-group records and recipient-private favorites.
      const [reviews, cache, favorites, shortlist] = await Promise.all([
        client
          .from('place_ratings')
          .select('place_id')
          .eq('organization_id', org.id)
          .in('place_id', body.ids),
        client
          .from('osm_region_cache')
          .select('places')
          .eq('organization_id', org.id)
          .maybeSingle(),
        client
          .from('restaurant_favorites')
          .select('place_id')
          .eq('organization_id', org.id)
          .in('place_id', body.ids),
        client
          .from('daily_lunch_options')
          .select('place_id')
          .eq('organization_id', org.id)
          .eq('is_shortlisted', true)
          .in('place_id', body.ids),
      ]);
      if (reviews.error || cache.error || favorites.error || shortlist.error)
        throw reviews.error ?? cache.error ?? favorites.error ?? shortlist.error;
      const authorizedIds = [
        ...new Set(
          [...(reviews.data ?? []), ...(favorites.data ?? []), ...(shortlist.data ?? [])].map(
            (row) => row.place_id,
          ),
        ),
      ];
      const stored = authorizedIds.length
        ? await client
            .from('places')
            .select('id,provider,metadata,refreshed_at')
            .in('id', authorizedIds)
        : { data: [], error: null };
      if (stored.error) throw stored.error;
      const available = new Map<string, Place>(
        (cache.data?.places ?? []).map((place: Place) => [place.id, place]),
      );
      for (const row of stored.data ?? [])
        available.set(
          row.id,
          row.provider === 'osm' && row.metadata
            ? ({ ...row.metadata, updatedAt: row.refreshed_at ?? row.metadata.updatedAt } as Place)
            : legacyPlace(row.id),
        );
      // Never send arbitrary caller IDs upstream: only vouched-for selected-group records qualify.
      const requested = new Map([...available].filter(([id]) => body.ids.includes(id)));
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const warning = await refreshPlaceFacts(
        admin,
        requested,
        body.refresh === true,
        body.automatic === true,
      );
      const places: Place[] = [];
      const failed: string[] = [];
      const overrides = await loadCuisineOverrides(client, org.id, body.ids);
      for (const id of body.ids) {
        const place = requested.get(id);
        if (place) places.push(applyCuisineOverride(place, overrides.get(id)));
        else failed.push(id);
      }
      return reply({ places, failed, warning });
    }
    return reply({ error: 'Unknown action' }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'OSM request failed' }, 502);
  }
}
if (import.meta.main) Deno.serve(handleRequest);
