import { assertEquals, assert } from 'jsr:@std/assert@1';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { addWalkingDistances } from './walking.ts';
import type { Place } from './osm.ts';
const org = { id: '10000000-0000-0000-0000-000000000001', latitude: 52.52, longitude: 13.39 };
const place: Place = {
  id: 'osm:node:1',
  provider: 'osm',
  name: 'Soup',
  latitude: 52.52,
  longitude: 13.4,
  address: '',
  category: 'Restaurant',
  types: [],
  hours: [],
};
const cached = {
  organization_id: org.id,
  place_id: place.id,
  origin_latitude: org.latitude,
  origin_longitude: org.longitude,
  latitude: place.latitude,
  longitude: place.longitude,
  meters: 900,
  seconds: 700,
  refreshed_at: new Date().toISOString(),
};
async function scenario(
  options: {
    cache?: object[];
    key?: boolean;
    gate?: boolean;
    status?: number;
    matrix?: unknown;
    origin?: typeof org;
    places?: Place[];
  } = {},
) {
  const original = globalThis.fetch;
  const previous = Deno.env.get('OPENROUTESERVICE_API_KEY');
  if (options.key === false) Deno.env.delete('OPENROUTESERVICE_API_KEY');
  else Deno.env.set('OPENROUTESERVICE_API_KEY', 'test-secret-never-return');
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const result = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    });
    if (url.includes('walking_distance_cache'))
      return Promise.resolve(result(init?.method === 'POST' ? null : (options.cache ?? [])));
    if (url.includes('claim_walking_request'))
      return Promise.resolve(result(options.gate !== false));
    if (url.includes('pause_walking_requests')) return Promise.resolve(result(null));
    if (url === 'https://api.heigit.org/openrouteservice/v2/matrix/foot-walking')
      return Promise.resolve(
        result(options.matrix ?? { distances: [[1200]], durations: [[950]] }, options.status),
      );
    throw new Error('Unexpected URL');
  };
  try {
    const admin = createClient('https://supabase.test', 'test-service', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const output = await addWalkingDistances(
      admin,
      options.origin ?? org,
      options.places ?? [place],
    );
    return {
      output,
      calls,
      provider: calls.filter((call) => call.url.includes('api.heigit.org')),
      writes: calls.filter((call) => call.url.includes('walking_distance_cache') && call.body),
    };
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) Deno.env.delete('OPENROUTESERVICE_API_KEY');
    else Deno.env.set('OPENROUTESERVICE_API_KEY', previous);
  }
}
Deno.test(
  'walking routes batch verified spots with longitude-first coordinates and server authorization',
  async () => {
    const destinations = Array.from({ length: 100 }, (_, i) => ({
      ...place,
      id: `osm:node:${i + 1}`,
    }));
    const { output, provider, writes } = await scenario({
      places: destinations,
      matrix: {
        distances: [destinations.map(() => 1200)],
        durations: [destinations.map(() => 950)],
      },
    });
    assertEquals(provider.length, 1);
    assertEquals(provider[0].body.locations[0], [13.39, 52.52]);
    assertEquals(provider[0].body.locations[1], [13.4, 52.52]);
    assertEquals(provider[0].body.sources, ['0']);
    assertEquals(provider[0].body.destinations.length, 100);
    assertEquals(provider[0].body.metrics, ['distance', 'duration']);
    assertEquals(provider[0].headers.get('Authorization'), 'test-secret-never-return');
    assertEquals(output.places[0].walking?.meters, 1200);
    assertEquals(writes[0].body.length, 100);
    assert(!JSON.stringify(output).includes('test-secret'));
  },
);
Deno.test(
  'walking cache hits are shared without provider calls, including a removed key',
  async () => {
    const { output, provider, calls } = await scenario({ cache: [cached], key: false });
    assertEquals(output.places[0].walking?.meters, 900);
    assertEquals(output.warning, '');
    assertEquals(provider.length, 0);
    assertEquals(calls.length, 1);
  },
);
Deno.test(
  'walking cache invalidates changed office/destination coordinates and stale entries',
  async () => {
    for (const row of [
      { ...cached, origin_latitude: 51 },
      { ...cached, longitude: 12 },
      { ...cached, refreshed_at: '2020-01-01T00:00:00Z' },
    ]) {
      const { provider, output } = await scenario({ cache: [row] });
      assertEquals(provider.length, 1);
      assertEquals(output.places[0].walking?.meters, 1200);
    }
  },
);
Deno.test('unreachable walks remain null and negative cache expires after a day', async () => {
  const { output } = await scenario({ matrix: { distances: [[null]], durations: [[null]] } });
  assertEquals(output.places[0].walking?.meters, null);
  assertEquals(output.warning, '');
  const hit = await scenario({ cache: [{ ...cached, meters: null, seconds: null }] });
  assertEquals(hit.provider.length, 0);
  const expired = await scenario({
    cache: [
      {
        ...cached,
        meters: null,
        seconds: null,
        refreshed_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ],
  });
  assertEquals(expired.provider.length, 1);
});
Deno.test(
  'missing keys, gated requests and upstream errors preserve cached walks and never fabricate routes',
  async () => {
    for (const options of [
      { key: false },
      { gate: false },
      { status: 429 },
      { status: 403 },
      { status: 503 },
      { matrix: { distances: [[-1]], durations: [[1]] } },
      { matrix: { distances: [[]], durations: [[]] } },
    ]) {
      const second = { ...place, id: 'osm:node:2' };
      const { output, writes, calls } = await scenario({
        ...options,
        cache: [cached],
        places: [place, second],
      });
      assertEquals(output.places[0].walking?.meters, 900);
      assertEquals(output.places[1].walking, undefined);
      assert(output.warning.length > 0);
      assertEquals(writes.length, 0);
      if ('status' in options && [403, 429].includes(options.status!))
        assert(calls.some((call) => call.url.includes('pause_walking_requests')));
    }
  },
);
Deno.test(
  'invalid offices and destinations do not use routing quota, and embedded routes are stripped',
  async () => {
    const invalid = await scenario({ origin: { ...org, latitude: 91 } });
    assertEquals(invalid.calls.length, 0);
    const noDestination = await scenario({ places: [{ ...place, longitude: null }] });
    assertEquals(noDestination.calls.length, 0);
    const injected = await scenario({
      key: false,
      places: [
        {
          ...place,
          walking: {
            originLatitude: 0,
            originLongitude: 0,
            latitude: 0,
            longitude: 0,
            meters: 0,
            seconds: 0,
          },
        },
      ],
    });
    assertEquals(injected.output.places[0].walking, undefined);
  },
);
