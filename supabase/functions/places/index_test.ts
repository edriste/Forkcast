import { assertEquals, assert } from 'jsr:@std/assert@1';
import { normalizeElement } from '../_shared/osm.ts';
Deno.env.set('SUPABASE_URL', 'https://supabase.test');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
const { handleRequest } = await import('./index.ts');
const org = '10000000-0000-0000-0000-000000000001';
const token = 'Bearer test-token';
const place = normalizeElement(
  {
    type: 'node',
    id: 1,
    lat: 52.52,
    lon: 13.4,
    tags: { amenity: 'restaurant', name: 'Miso Kitchen', cuisine: 'japanese' },
  },
  '2026-01-01T00:00:00Z',
)!;
type Options = {
  member?: boolean;
  fresh?: boolean;
  stale?: boolean;
  gate?: boolean;
  unavailable?: boolean;
  partial?: boolean;
  details?: boolean;
  located?: boolean;
  locationCache?: boolean;
  emptyLocations?: boolean;
  locationStatus?: number;
  cuisines?: boolean;
  detailsStale?: boolean;
  reviewed?: boolean;
  refreshClaim?: boolean;
  updatedCuisine?: boolean;
  emptyElements?: boolean;
  favorite?: boolean;
  shortlisted?: boolean;
};
async function scenario(body: object, options: Options = {}) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body?: string }[] = [];
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const path = new URL(url).pathname;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (path === '/auth/v1/user') return response({ id: 'user-one', aud: 'authenticated' });
    if (path === '/rest/v1/organizations')
      return options.member === false
        ? response({ message: 'Not found', code: 'PGRST116' }, 406)
        : response({
            id: org,
            search_area: 'Berlin Mitte',
            ...(options.located ? { latitude: 48.1, longitude: 11.5 } : {}),
          });
    if (path === '/rest/v1/walking_distance_cache')
      return response(init?.method === 'POST' ? null : []);
    if (path === '/rest/v1/rpc/claim_walking_request') return response(true);
    if (url === 'https://api.heigit.org/openrouteservice/v2/matrix/foot-walking')
      return response({ distances: [[1250]], durations: [[1000]] });
    if (path === '/rest/v1/osm_location_cache') {
      if (init?.method === 'POST') return response(null);
      return response(
        options.locationCache
          ? {
              locations: [{ label: 'Saved office', latitude: 52.52, longitude: 13.4 }],
              refreshed_at: new Date().toISOString(),
            }
          : null,
      );
    }
    if (path === '/rest/v1/osm_region_cache') {
      if (init?.method === 'PATCH') return response({ organization_id: org });
      if (options.details)
        return response({
          places: [
            {
              ...place,
              updatedAt: options.detailsStale ? place.updatedAt : new Date().toISOString(),
            },
          ],
        });
      if (options.fresh || options.stale)
        return response({
          area_query: 'Berlin Mitte',
          latitude: 52.52,
          longitude: 13.4,
          places: [place],
          refreshed_at: options.fresh ? new Date().toISOString() : '2026-01-01T00:00:00Z',
        });
      return response(null);
    }
    if (path === '/rest/v1/rpc/claim_osm_refresh')
      return response('20000000-0000-0000-0000-000000000001');
    if (path === '/rest/v1/rpc/claim_osm_request') return response(options.gate !== false);
    if (path === '/rest/v1/place_ratings')
      return response(options.reviewed ? [{ place_id: place.id }] : []);
    if (path === '/rest/v1/restaurant_favorites')
      return response(options.favorite ? [{ place_id: place.id }] : []);
    if (path === '/rest/v1/daily_lunch_options')
      return response(options.shortlisted ? [{ place_id: place.id }] : []);
    if (path === '/rest/v1/rpc/claim_osm_place_refresh')
      return response(
        options.refreshClaim === false ? [] : [{ place_id: place.id, token: 'batch' }],
      );
    if (path === '/rest/v1/rpc/finish_osm_place_refresh') return response(null);
    if (path === '/rest/v1/place_cuisine_overrides')
      return response(
        options.cuisines
          ? [
              {
                place_id: place.id,
                cuisines: ['italian', 'pizza'],
                updated_at: '2026-10-12T12:00:00Z',
              },
            ]
          : [],
      );
    if (path === '/rest/v1/places')
      return response(
        (options.reviewed || options.favorite || options.shortlisted) && init?.method !== 'POST'
          ? [{ id: place.id, provider: 'osm', metadata: place, refreshed_at: place.updatedAt }]
          : [],
      );
    if (url.startsWith('https://nominatim.openstreetmap.org/')) {
      if (options.locationStatus)
        return response({ error: 'Private upstream response' }, options.locationStatus);
      return response(
        options.emptyLocations
          ? []
          : [{ display_name: 'Berlin Mitte, Germany', lat: '52.52', lon: '13.4' }],
      );
    }
    if (url.startsWith('https://overpass-api.de/')) {
      if (options.unavailable) return response({ error: 'Busy' }, 429);
      if (options.partial) return response({ elements: [], remark: 'runtime error: timeout' });
      if (options.emptyElements) return response({ elements: [] });
      return response({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 52.52,
            lon: 13.4,
            tags: {
              amenity: 'restaurant',
              name: 'Miso Kitchen',
              ...(options.updatedCuisine ? { cuisine: 'thai' } : {}),
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  };
  try {
    const result = await handleRequest(
      new Request('https://function.test', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: org, ...body }),
      }),
    );
    return { status: result.status, data: await result.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}
Deno.test('unauthenticated requests never reach upstream services', async () => {
  const result = await handleRequest(new Request('https://function.test', { method: 'POST' }));
  assertEquals(result.status, 401);
});
Deno.test('nonmembers cannot access cached data or trigger a public lookup', async () => {
  const result = await scenario({ action: 'search', query: 'Miso' }, { member: false });
  assertEquals(result.status, 403);
  assertEquals(result.calls.length, 2);
});
Deno.test('fresh cached searches do not call Nominatim or Overpass', async () => {
  const result = await scenario({ action: 'search', query: 'japanese' }, { fresh: true });
  assertEquals(result.status, 200);
  assertEquals(result.data.places[0].id, 'osm:node:1');
  assert(result.calls.every((call) => call.url.startsWith('https://supabase.test')));
});
Deno.test('first search identifies requests, registers OSM facts and caches the area', async () => {
  const result = await scenario({ action: 'search', query: 'Miso' });
  assertEquals(result.status, 200);
  assertEquals(result.data.places[0].provider, 'osm');
  assert(result.calls.some((call) => call.url.startsWith('https://nominatim.openstreetmap.org')));
  assert(result.calls.some((call) => call.url.startsWith('https://overpass-api.de')));
  assert(
    result.calls.some((call) => call.method === 'POST' && call.url.includes('/rest/v1/places')),
  );
});
Deno.test('stale coordinates are reused; upstream failure preserves saved results', async () => {
  const result = await scenario(
    { action: 'search', query: 'Miso' },
    { stale: true, unavailable: true },
  );
  assertEquals(result.status, 200);
  assertEquals(result.data.places[0].id, place.id);
  assert(result.data.warning.includes('Showing saved OSM data'));
  assert(!result.calls.some((call) => call.url.startsWith('https://nominatim.openstreetmap.org')));
});
Deno.test('HTTP 200 partial Overpass responses do not replace a complete cache', async () => {
  const result = await scenario(
    { action: 'search', query: 'Miso' },
    { stale: true, partial: true },
  );
  assertEquals(result.data.places[0].id, place.id);
  assert(result.data.warning);
  assert(
    !result.calls.some((call) => call.method === 'POST' && call.url.includes('/rest/v1/places')),
  );
});
Deno.test('a denied global gate prevents upstream calls', async () => {
  const result = await scenario({ action: 'search', query: 'Miso' }, { gate: false });
  assertEquals(result.status, 502);
  assert(result.calls.every((call) => call.url.startsWith('https://supabase.test')));
});
Deno.test(
  'details expose only selected-group reviews or its cached search selections',
  async () => {
    const result = await scenario(
      { action: 'details', ids: [place.id, 'osm:node:999'] },
      { details: true },
    );
    assertEquals(result.status, 200);
    assertEquals(result.data.places.length, 1);
    assertEquals(result.data.failed, ['osm:node:999']);
    assert(result.calls.some((call) => call.url.includes('organization_id=eq.')));
    assert(result.calls.every((call) => call.url.startsWith('https://supabase.test')));
  },
);

Deno.test(
  'office location lookup works before group creation and caches explicit searches',
  async () => {
    const result = await scenario(
      { action: 'locations', query: 'Berlin office', organizationId: undefined },
      { member: false },
    );
    assertEquals(result.status, 200);
    assertEquals(result.data.locations[0], {
      label: 'Berlin Mitte, Germany',
      latitude: 52.52,
      longitude: 13.4,
    });
    assert(!result.calls.some((call) => call.url.includes('/organizations')));
    assert(
      result.calls.some(
        (call) => call.url.includes('/osm_location_cache') && call.method === 'POST',
      ),
    );
    assert(!result.calls.some((call) => call.url.startsWith('https://overpass-api.de')));
    const cached = await scenario(
      { action: 'locations', query: 'Berlin office' },
      { locationCache: true },
    );
    assertEquals(cached.data.locations[0].label, 'Saved office');
    assert(cached.calls.every((call) => call.url.startsWith('https://supabase.test')));
  },
);
Deno.test('office lookup enforces the shared Nominatim gate and validates queries', async () => {
  const busy = await scenario({ action: 'locations', query: 'Berlin office' }, { gate: false });
  assertEquals(busy.status, 429);
  assert(busy.calls.every((call) => call.url.startsWith('https://supabase.test')));
  const invalid = await scenario({ action: 'locations', query: 'a' });
  assertEquals(invalid.status, 400);
  assertEquals(invalid.calls.length, 1);
  const empty = await scenario(
    { action: 'locations', query: 'Missing office' },
    { emptyLocations: true },
  );
  assertEquals(empty.status, 200);
  assertEquals(empty.data.locations, []);
});
Deno.test(
  'office lookup distinguishes provider denial, rate limits and outages without leaking addresses',
  async () => {
    const original = console.warn;
    const logs: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      for (const status of [401, 403, 429, 503]) {
        const result = await scenario(
          { action: 'locations', query: 'Private office address' },
          { locationStatus: status },
        );
        assertEquals(result.status, 502);
        assert(
          result.data.error.includes(
            status === 429 ? 'rate limited' : status === 503 ? 'busy or unavailable' : 'was denied',
          ),
        );
        assert(!JSON.stringify(result.data).includes('Private upstream response'));
        assert(
          !result.calls.some(
            (call) => call.url.includes('/osm_location_cache') && call.method === 'POST',
          ),
        );
        assertEquals(logs.at(-1), [
          'OSM upstream request failed',
          { host: 'nominatim.openstreetmap.org', status },
        ]);
      }
      assert(!JSON.stringify(logs).includes('Private office address'));
    } finally {
      console.warn = original;
    }
  },
);
Deno.test(
  'restaurant search uses the chosen office coordinates without geocoding its label',
  async () => {
    const result = await scenario({ action: 'search', query: 'Miso' }, { located: true });
    assertEquals(result.status, 200);
    assert(
      !result.calls.some((call) => call.url.startsWith('https://nominatim.openstreetmap.org')),
    );
    assert(result.calls.some((call) => call.url.startsWith('https://overpass-api.de')));
  },
);

Deno.test(
  'team cuisine corrections are merged before search and into selected-group details',
  async () => {
    const search = await scenario(
      { action: 'search', query: 'italian' },
      { fresh: true, cuisines: true },
    );
    assertEquals(search.status, 200);
    assertEquals(search.data.places.length, 1);
    assert(search.data.places[0].types.includes('cuisine:italian'));
    assert(!search.data.places[0].types.includes('cuisine:japanese'));
    const detail = await scenario(
      { action: 'details', ids: [place.id] },
      { details: true, cuisines: true },
    );
    assertEquals(detail.status, 200);
    assertEquals(detail.data.places[0].cuisineOverride.cuisines, ['italian', 'pizza']);
    assert(
      detail.calls.some(
        (call) =>
          call.url.includes('/place_cuisine_overrides') && call.url.includes('organization_id=eq.'),
      ),
    );
    const normal = await scenario({ action: 'details', ids: [place.id] }, { details: true });
    assertEquals(normal.data.places[0].types.includes('cuisine:japanese'), true);
    assertEquals(normal.data.places[0].cuisineOverride, undefined);
  },
);

Deno.test(
  'stale reviewed facts refresh by exact OSM ID even outside a cached office region',
  async () => {
    const result = await scenario(
      { action: 'details', ids: [place.id, 'osm:node:999'] },
      { reviewed: true, updatedCuisine: true },
    );
    assertEquals(result.status, 200);
    assert(result.data.places[0].types.includes('cuisine:thai'));
    assertEquals(result.data.failed, ['osm:node:999']);
    const request = result.calls.find((call) => call.url.startsWith('https://overpass-api.de'))!;
    const query = new URLSearchParams(request.body).get('data')!;
    assert(query.includes('node(1);'));
    assert(!query.includes('999'));
    assert(!query.includes('around:'));
    assert(
      result.calls.some(
        (call) => call.url.includes('finish_osm_place_refresh') && JSON.parse(call.body!).succeeded,
      ),
    );
  },
);
Deno.test(
  'manual OSM refresh bypasses a fresh detail snapshot and preserves a team override',
  async () => {
    const result = await scenario(
      { action: 'details', ids: [place.id], refresh: true },
      { details: true, updatedCuisine: true, cuisines: true },
    );
    assertEquals(result.status, 200);
    assertEquals(result.data.places[0].cuisineOverride.cuisines, ['italian', 'pizza']);
    const save = result.calls.find((call) => call.url.includes('finish_osm_place_refresh'))!;
    assert(JSON.parse(save.body!).updates[0].types.includes('cuisine:thai'));
  },
);
Deno.test(
  'busy, unavailable and partial source refreshes keep reviewed cuisine and report a warning',
  async () => {
    for (const options of [
      { gate: false },
      { unavailable: true },
      { partial: true },
      { emptyElements: true },
    ]) {
      const result = await scenario(
        { action: 'details', ids: [place.id] },
        { reviewed: true, ...options },
      );
      assertEquals(result.status, 200);
      assert(result.data.places[0].types.includes('cuisine:japanese'));
      assert(result.data.warning.length > 0);
    }
    const cooldown = await scenario(
      { action: 'details', ids: [place.id], refresh: true },
      { details: true, refreshClaim: false },
    );
    assert(cooldown.data.warning.includes('recently'));
    assert(!cooldown.calls.some((call) => call.url.startsWith('https://overpass-api.de')));
  },
);
Deno.test('invalid or unavailable IDs cannot trigger forced public lookups', async () => {
  const result = await scenario({ action: 'details', ids: ['osm:node:999'], refresh: true });
  assertEquals(result.data.failed, ['osm:node:999']);
  assert(!result.calls.some((call) => call.url.startsWith('https://overpass-api.de')));
  const invalid = await scenario(
    { action: 'details', ids: [place.id], refresh: 'yes' },
    { details: true },
  );
  assertEquals(invalid.status, 400);
});

Deno.test('automatic source checks quietly reuse recently checked facts', async () => {
  const result = await scenario(
    { action: 'details', ids: [place.id], refresh: true, automatic: true },
    { details: true, refreshClaim: false },
  );
  assertEquals(result.status, 200);
  assertEquals(result.data.warning, '');
  assert(!result.calls.some((call) => call.url.startsWith('https://overpass-api.de')));
});

Deno.test(
  'details preserve owned favorites and shared nominations outside the regional cache',
  async () => {
    for (const source of ['favorite', 'shortlisted'] as const) {
      const result = await scenario(
        { action: 'details', organizationId: org, ids: [place.id, 'osm:node:999'] },
        { [source]: true, refreshClaim: false },
      );
      assertEquals(result.status, 200);
      assertEquals(
        result.data.places.map((item: { id: string }) => item.id),
        [place.id],
      );
      assertEquals(result.data.failed, ['osm:node:999']);
      const ownership = result.calls.find(
        (call) =>
          new URL(call.url).pathname ===
          '/rest/v1/' + (source === 'favorite' ? 'restaurant_favorites' : 'daily_lunch_options'),
      )!;
      assertEquals(new URL(ownership.url).searchParams.get('organization_id'), 'eq.' + org);
      assert(!result.calls.some((call) => call.url.includes('overpass-api.de')));
    }
  },
);

Deno.test(
  'authenticated searches and vouched-for details receive walking distances; outsiders never route',
  async () => {
    const previous = Deno.env.get('OPENROUTESERVICE_API_KEY');
    Deno.env.set('OPENROUTESERVICE_API_KEY', 'test-routing-secret');
    try {
      const search = await scenario(
        { action: 'search', query: 'Miso' },
        { fresh: true, located: true },
      );
      assertEquals(search.data.places[0].walking.meters, 1250);
      const detail = await scenario(
        { action: 'details', ids: [place.id] },
        { details: true, located: true },
      );
      assertEquals(detail.data.places[0].walking.originLatitude, 48.1);
      assertEquals(detail.data.places[0].walking.meters, 1250);
      const denied = await scenario(
        { action: 'details', ids: [place.id] },
        { member: false, located: true },
      );
      assertEquals(denied.status, 403);
      assert(!denied.calls.some((call) => call.url.includes('openrouteservice')));
      const unknown = await scenario(
        { action: 'details', ids: ['osm:node:999'] },
        { located: true },
      );
      assertEquals(unknown.data.places.length, 0);
      assert(!unknown.calls.some((call) => call.url.includes('openrouteservice')));
    } finally {
      if (previous === undefined) Deno.env.delete('OPENROUTESERVICE_API_KEY');
      else Deno.env.set('OPENROUTESERVICE_API_KEY', previous);
    }
  },
);
