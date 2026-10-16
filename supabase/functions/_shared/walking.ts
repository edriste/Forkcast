import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Place, WalkingRoute } from './osm.ts';
type Origin = { id: string; latitude?: number | null; longitude?: number | null };
type Cached = {
  place_id: string;
  origin_latitude: number;
  origin_longitude: number;
  latitude: number;
  longitude: number;
  meters: number | null;
  seconds: number | null;
  refreshed_at: string;
};
export function validPoint(point: { latitude?: number | null; longitude?: number | null }) {
  return (
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180
  );
}
function route(row: Cached): WalkingRoute {
  return {
    originLatitude: row.origin_latitude,
    originLongitude: row.origin_longitude,
    latitude: row.latitude,
    longitude: row.longitude,
    meters: row.meters,
    seconds: row.seconds,
  };
}
/** One office to many verified destinations. Never accept caller-supplied coordinates. */
export async function addWalkingDistances(admin: SupabaseClient, org: Origin, input: Place[]) {
  const places = input.map((place) => {
    // Cached OSM snapshots must not carry a route belonging to a different organization.
    const { walking: _walking, ...facts } = place;
    return facts as Place;
  });
  if (!validPoint(org)) return { places, warning: '' };
  const destinations = places.filter((place) => place.provider === 'osm' && validPoint(place));
  if (!destinations.length) return { places, warning: '' };
  const fallback =
    'Walking routes are temporarily unavailable. Straight-line estimates are labelled separately.';
  try {
    const { data, error } = await admin
      .from('walking_distance_cache')
      .select('*')
      .eq('organization_id', org.id)
      .in(
        'place_id',
        destinations.map((place) => place.id),
      );
    if (error) throw error;
    const cached = new Map<string, Cached>((data ?? []).map((row: Cached) => [row.place_id, row]));
    const missing: Place[] = [];
    for (const place of destinations) {
      const row = cached.get(place.id);
      const ttl = row?.meters === null ? 86400000 : 30 * 86400000;
      if (
        row &&
        row.origin_latitude === org.latitude &&
        row.origin_longitude === org.longitude &&
        row.latitude === place.latitude &&
        row.longitude === place.longitude &&
        Date.parse(row.refreshed_at) > Date.now() - ttl
      ) {
        place.walking = route(row);
      } else missing.push(place);
    }
    if (!missing.length) return { places, warning: '' };
    const key = Deno.env.get('OPENROUTESERVICE_API_KEY');
    if (!key)
      return {
        places,
        warning:
          'Walking routes are not configured. Distances shown as straight line are estimates.',
      };
    const gate = await admin.rpc('claim_walking_request');
    if (gate.error) throw gate.error;
    if (!gate.data) return { places, warning: fallback };
    const response = await fetch('https://api.heigit.org/openrouteservice/v2/matrix/foot-walking', {
      method: 'POST',
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        locations: [
          [org.longitude, org.latitude],
          ...missing.map((place) => [place.longitude, place.latitude]),
        ],
        sources: ['0'],
        destinations: missing.map((_, index) => String(index + 1)),
        metrics: ['distance', 'duration'],
        units: 'm',
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      // A shared key can also be used outside Forkcast. Avoid repeatedly hitting exhausted quotas.
      if ([401, 403, 429].includes(response.status)) await admin.rpc('pause_walking_requests');
      throw new Error('Routing unavailable');
    }
    const body = await response.json();
    const distances = body?.distances?.[0],
      durations = body?.durations?.[0];
    if (
      !Array.isArray(distances) ||
      !Array.isArray(durations) ||
      distances.length !== missing.length ||
      durations.length !== missing.length ||
      [...distances, ...durations].some(
        (value) =>
          value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0),
      )
    )
      throw new Error('Invalid matrix');
    const rows = missing.map((place, index) => ({
      organization_id: org.id,
      place_id: place.id,
      origin_latitude: org.latitude!,
      origin_longitude: org.longitude!,
      latitude: place.latitude!,
      longitude: place.longitude!,
      meters: distances[index] === null || durations[index] === null ? null : distances[index],
      seconds: distances[index] === null || durations[index] === null ? null : durations[index],
      refreshed_at: new Date().toISOString(),
    }));
    const saved = await admin.from('walking_distance_cache').upsert(rows);
    if (saved.error) throw saved.error;
    missing.forEach((place, index) => {
      place.walking = route(rows[index]);
    });
    return { places, warning: '' };
  } catch {
    // Never forward provider responses, keys or internal database errors to the app.
    return { places, warning: fallback };
  }
}
