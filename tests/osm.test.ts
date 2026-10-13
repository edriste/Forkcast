import { expect, test } from 'vitest';
import {
  legacyPlace,
  mapBounds,
  normalizeElement,
  safeWebsite,
  searchPlaces,
} from '../supabase/functions/_shared/osm';
const date = '2026-10-12T12:00:00Z';
test('OSM nodes, ways and relations retain provider identity and available restaurant facts', () => {
  const node = normalizeElement(
    {
      type: 'node',
      id: 42,
      lat: 52.52,
      lon: 13.4,
      tags: {
        amenity: 'restaurant',
        name: 'Café Miso',
        cuisine: 'japanese;vegan',
        opening_hours: 'Mo-Fr 11:00-15:00',
        'addr:street': 'Lunchstrasse',
        'addr:housenumber': '4',
        website: 'https://example.test',
      },
    },
    date,
  )!;
  expect(node).toMatchObject({
    id: 'osm:node:42',
    name: 'Café Miso',
    latitude: 52.52,
    longitude: 13.4,
    types: ['restaurant', 'cuisine:japanese', 'cuisine:vegan'],
    hours: ['Mo-Fr 11:00-15:00'],
  });
  expect(node.address).toBe('Lunchstrasse 4');
  expect(
    normalizeElement(
      {
        type: 'way',
        id: 42,
        center: { lat: 52, lon: 13 },
        tags: { amenity: 'cafe', name: 'Lunch' },
      },
      date,
    )?.id,
  ).toBe('osm:way:42');
  expect(
    normalizeElement(
      {
        type: 'relation',
        id: 42,
        center: { lat: 52, lon: 13 },
        tags: { shop: 'bakery', name: 'Bread' },
      },
      date,
    )?.id,
  ).toBe('osm:relation:42');
});
test('missing cuisine and hours remain explicit, and unsafe URLs are excluded', () => {
  const place = normalizeElement(
    {
      type: 'node',
      id: 1,
      lat: 0,
      lon: 0,
      tags: { amenity: 'restaurant', name: 'Lunch', website: 'javascript:alert(1)' },
    },
    date,
  )!;
  expect(place.types).toContain('cuisine:unknown');
  expect(place.hours).toEqual([]);
  expect(place.website).toBeUndefined();
  expect(place.address).toBe('Address not listed');
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://example.test',
    'https://user:password@example.test',
    'not a url',
  ])
    expect(safeWebsite(url)).toBeUndefined();
  expect(safeWebsite('www.example.test')).toBe('https://www.example.test/');
});
test('invalid or unnamed records are not selectable', () => {
  expect(
    normalizeElement(
      { type: 'node', id: 1, lat: 91, lon: 0, tags: { amenity: 'restaurant', name: 'Bad' } },
      date,
    ),
  ).toBeNull();
  expect(
    normalizeElement(
      { type: 'node', id: 1, lat: 52, lon: 13, tags: { amenity: 'restaurant' } },
      date,
    ),
  ).toBeNull();
});
test('cached search handles names, cuisines and accents without constructing upstream queries', () => {
  const place = normalizeElement(
    {
      type: 'node',
      id: 1,
      lat: 52,
      lon: 13,
      tags: { amenity: 'restaurant', name: 'Café Miso', cuisine: 'japanese' },
    },
    date,
  )!;
  expect(searchPlaces([place], 'cafe miso')).toEqual([place]);
  expect(searchPlaces([place], 'Japanese')).toEqual([place]);
  expect(searchPlaces([place], 'Italian')).toEqual([]);
  expect(searchPlaces([place], '[out:json];')).toEqual([]);
});
test('legacy records have no invented coordinates; valid zero coordinates stay on the map', () => {
  const old = legacyPlace('old-google-id');
  expect(old.latitude).toBeNull();
  expect(mapBounds([old])).toBeNull();
  const place = normalizeElement(
    { type: 'node', id: 1, lat: 0, lon: 0, tags: { amenity: 'restaurant', name: 'Zero' } },
    date,
  )!;
  expect(mapBounds([old, place])).toEqual([-0.002, -0.002, 0.002, 0.002]);
});
