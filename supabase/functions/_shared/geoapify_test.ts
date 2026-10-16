import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { discoverGeoapify, normalizeGeoapify, refreshGeoapify } from './geoapify.ts';

const updatedAt = '2026-10-16T12:00:00Z';
const feature = (id = 1) => ({
  properties: {
    name: 'Lunch Café',
    lat: 50.936,
    lon: 6.939,
    street: 'Rudolfplatz',
    housenumber: '14',
    postcode: '50674',
    city: 'Köln',
    datasource: {
      sourcename: 'openstreetmap',
      raw: {
        osm_type: 'n',
        osm_id: id,
        amenity: 'cafe',
        cuisine: 'coffee_shop;cake',
        opening_hours: 'Mo-Fr 09:00-18:00',
        website: 'https://example.com',
      },
    },
  },
});

Deno.test(
  'Geoapify normalization preserves source tags, safe URLs and all OSM object types',
  () => {
    for (const [short, long] of [
      ['n', 'node'],
      ['w', 'way'],
      ['r', 'relation'],
    ]) {
      const row = feature();
      row.properties.datasource.raw.osm_type = short;
      const place = normalizeGeoapify(row, updatedAt)!;
      assertEquals(place.id, `osm:${long}:1`);
      assertEquals(place.address, 'Rudolfplatz 14, 50674 Köln');
      assertEquals(place.hours, ['Mo-Fr 09:00-18:00']);
      assertEquals(place.website, 'https://example.com/');
      assertEquals(place.mapsUrl, `https://www.openstreetmap.org/${long}/1`);
      assertEquals(place.dataSource, 'geoapify');
    }
    const row = feature();
    row.properties.datasource.raw.website = 'javascript:alert(1)';
    assertEquals(normalizeGeoapify(row, updatedAt)!.website, undefined);
  },
);

Deno.test('Geoapify rejects unsupported identities, invalid coordinates and unnamed places', () => {
  for (const row of [
    null,
    {},
    { properties: null },
    { properties: {} },
    { properties: { ...feature().properties, datasource: { sourcename: 'other', raw: {} } } },
    { properties: { ...feature().properties, lat: 100 } },
    { properties: { ...feature().properties, name: '' } },
    {
      properties: {
        ...feature().properties,
        datasource: { sourcename: 'openstreetmap', raw: { osm_type: 'w', osm_id: -1 } },
      },
    },
  ])
    assertEquals(normalizeGeoapify(row, updatedAt), null);
});

async function withKey(work: () => Promise<void>) {
  const old = Deno.env.get('GEOAPIFY_API_KEY');
  Deno.env.set('GEOAPIFY_API_KEY', 'private-test-key');
  try {
    await work();
  } finally {
    if (old === undefined) Deno.env.delete('GEOAPIFY_API_KEY');
    else Deno.env.set('GEOAPIFY_API_KEY', old);
  }
}

Deno.test('Geoapify discovery paginates and deduplicates before publishing an area', async () => {
  await withKey(async () => {
    const offsets: string[] = [];
    const places = await discoverGeoapify(50.936, 6.939, async (url) => {
      const parsed = new URL(url);
      offsets.push(parsed.searchParams.get('offset')!);
      assertEquals(parsed.searchParams.get('filter'), 'circle:6.939,50.936,3000');
      return {
        features:
          offsets.length === 1
            ? Array.from({ length: 500 }, (_, i) => feature(i + 1))
            : [feature(500), feature(501)],
      };
    });
    assertEquals(offsets, ['0', '500']);
    assertEquals(places.length, 501);
  });
});

Deno.test(
  'Geoapify never publishes partial, malformed or unsupported-only catalogues',
  async () => {
    await withKey(async () => {
      for (const data of [{}, { features: null }, { features: [{}] }])
        await assertRejects(() => discoverGeoapify(50, 6, async () => data));
      let calls = 0;
      await assertRejects(
        () =>
          discoverGeoapify(50, 6, async () => {
            calls++;
            if (calls === 2) throw new Error('page two failed');
            return { features: Array.from({ length: 500 }, (_, i) => feature(i + 1)) };
          }),
        Error,
        'page two failed',
      );
    });
  },
);

Deno.test('Geoapify detail refresh accepts only requested identities', async () => {
  await withKey(async () => {
    const places = await refreshGeoapify(['osm:node:1'], async (url) => {
      assertEquals(new URL(url).searchParams.get('osm_type'), 'n');
      assertEquals(new URL(url).searchParams.get('features'), 'details');
      return { features: [feature(2), feature(1)] };
    });
    assertEquals(
      places.map((place) => place.id),
      ['osm:node:1'],
    );
    assert(!JSON.stringify(places).includes('private-test-key'));
  });
});

Deno.test(
  'Geoapify caps discovery work without silently publishing truncated results',
  async () => {
    await withKey(async () => {
      let pages = 0;
      await assertRejects(
        () =>
          discoverGeoapify(50, 6, async (_url, options) => {
            assert(options?.signal instanceof AbortSignal);
            pages++;
            return { features: Array.from({ length: 500 }, (_, i) => feature(i + 1)) };
          }),
        Error,
        'too large',
      );
      assertEquals(pages, 8);
    });
  },
);
