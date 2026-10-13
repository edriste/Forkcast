import { expect, test } from 'vitest';
import {
  applyCuisineOverride,
  osmEditUrl,
  parseCuisines,
} from '../supabase/functions/_shared/cuisines';
import { legacyPlace, normalizeElement, searchPlaces } from '../supabase/functions/_shared/osm';
import { searchCuisineOptions } from '../supabase/functions/_shared/cuisineCatalogue';
const place = normalizeElement(
  {
    type: 'node',
    id: 42,
    lat: 52.52,
    lon: 13.4,
    tags: { name: 'Lunch Spot', amenity: 'restaurant' },
  },
  '2026-10-12',
)!;
test('manual cuisines normalize and deduplicate meaningful multi-cuisine input', () => {
  expect(parseCuisines('Italian, pizza; Italian, Middle Eastern')).toEqual([
    'italian',
    'pizza',
    'middle_eastern',
  ]);
  for (const invalid of [
    '',
    'unknown',
    '<script>',
    Array.from({ length: 9 }, (_, i) => `cuisine${i}`).join(','),
  ])
    expect(() => parseCuisines(invalid)).toThrow();
});
test('a team correction replaces unknown cuisine without modifying OSM facts and is searchable', () => {
  const corrected = applyCuisineOverride(place, {
    cuisines: ['italian', 'pizza'],
    updatedAt: '2026-10-12',
  });
  expect(corrected.types).toContain('cuisine:italian');
  expect(corrected.types).not.toContain('cuisine:unknown');
  expect(corrected.category).toBe('Restaurant · Italian, Pizza');
  expect(searchPlaces([corrected], 'italian')).toHaveLength(1);
  expect(place.types).toContain('cuisine:unknown');
  expect(applyCuisineOverride(place)).toBe(place);
});
test('OSM editor links target the exact node, way or relation and exclude legacy identifiers', () => {
  for (const type of ['node', 'way', 'relation']) {
    const url = new URL(osmEditUrl({ ...place, id: `osm:${type}:42` })!);
    expect(url.origin).toBe('https://www.openstreetmap.org');
    expect(url.pathname).toBe('/edit');
    expect(url.searchParams.get('editor')).toBe('id');
    expect(url.searchParams.get(type)).toBe('42');
    expect(url.hash).toContain('52.52/13.4');
  }
  expect(osmEditUrl(legacyPlace('legacy'))).toBeUndefined();
  expect(osmEditUrl({ ...place, id: 'osm:node:42&other=1' })).toBeUndefined();
});

test('established OSM spellings and labels normalize to the same stored tag', () => {
  expect(parseCuisines('Tex-Mex, tex mex, tex_mex')).toEqual(['tex-mex']);
  expect(parseCuisines('Waffles, Coffee Shop, Gyūdon, burgers')).toEqual([
    'waffle',
    'coffee_shop',
    'beef_bowl',
    'burger',
  ]);
  const imported = normalizeElement(
    {
      type: 'node',
      id: 43,
      lat: 52,
      lon: 13,
      tags: { name: 'Tex-Mex place', amenity: 'restaurant', cuisine: 'tex-mex' },
    },
    '2026-10-12',
  )!;
  expect(imported.types).toContain('cuisine:tex-mex');
  expect(imported.category).toBe('Restaurant · Tex-Mex');
  const previous = applyCuisineOverride({ ...imported, types: ['restaurant', 'cuisine:tex_mex'] });
  expect(previous.types).toContain('cuisine:tex-mex');
  expect(previous.types).not.toContain('cuisine:tex_mex');
});

test('the picker searches friendly labels and retains selected tags outside its presets', () => {
  expect(searchCuisineOptions('tex mex').map((option) => option.value)).toEqual(['tex-mex']);
  expect(searchCuisineOptions('gyudon').map((option) => option.value)).toEqual(['beef_bowl']);
  expect(searchCuisineOptions('office noodles', ['office_noodles'])).toEqual([
    { value: 'office_noodles', label: 'Office noodles', established: false },
  ]);
});
