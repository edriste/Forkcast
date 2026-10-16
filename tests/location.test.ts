import { expect, test } from 'vitest';
import {
  normalizeLocations,
  compactLocationLabel,
  officeAddressDisplay,
  normalizePeliasLocations,
} from '../supabase/functions/_shared/location';
import { mapBounds } from '../supabase/functions/_shared/osm';
test('Pelias locations validate GeoJSON points and retain compact addresses', () => {
  const feature = {
    geometry: { type: 'Point', coordinates: [6.939, 50.936] },
    properties: {
      street: 'Rudolfplatz',
      housenumber: '14',
      locality: 'Köln',
      postalcode: '50674',
      country: 'Germany',
      country_a: 'DEU',
    },
  };
  expect(
    normalizePeliasLocations({
      features: [
        feature,
        null,
        { ...feature, geometry: { type: 'LineString', coordinates: [6.939, 50.936] } },
        { ...feature, geometry: { type: 'Point', coordinates: [null, 50] } },
        { ...feature, geometry: { type: 'Point', coordinates: [7, 91] } },
      ],
    }),
  ).toEqual([{ label: 'Rudolfplatz 14, 50674 Köln, Germany', latitude: 50.936, longitude: 6.939 }]);
  expect(
    normalizePeliasLocations({
      features: [
        { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { label: 'A place' } },
      ],
    })[0],
  ).toEqual({ label: 'A place', latitude: 0, longitude: 0 });
  expect(
    normalizePeliasLocations({
      features: [
        {
          ...feature,
          properties: {
            street: 'Downing Street',
            housenumber: '10',
            locality: 'London',
            country: 'United Kingdom',
            country_a: 'GBR',
          },
        },
      ],
    })[0].label,
  ).toBe('10 Downing Street, London, United Kingdom');
  expect(() => normalizePeliasLocations({ error: 'invalid' })).toThrow();
  expect(normalizePeliasLocations({ features: [] })).toEqual([]);
});
test('location results reject invalid coordinates and labels', () => {
  expect(
    normalizeLocations([
      { display_name: ' Office ', lat: '52.52', lon: '13.4' },
      { display_name: 'Invalid', lat: '91', lon: '13' },
      { display_name: 'Invalid', lat: null, lon: '13' },
      { display_name: 'Invalid', lat: 'NaN', lon: '13' },
      { lat: '52', lon: '13' },
      null,
    ]),
  ).toEqual([{ label: 'Office', latitude: 52.52, longitude: 13.4 }]);
});
test('map bounds show an office even with no reviewed restaurants', () => {
  const officeBounds = mapBounds([{ latitude: 52.52, longitude: 13.4 }])!;
  expect(officeBounds[0]).toBeLessThan(13.4);
  expect(officeBounds[1]).toBeLessThan(52.52);
  expect(officeBounds[2]).toBeGreaterThan(13.4);
  expect(officeBounds[3]).toBeGreaterThan(52.52);
  const bounds = mapBounds([
    { latitude: 52.52, longitude: 13.4 },
    { latitude: 52.6, longitude: 13.5 },
  ])!;
  expect(bounds[0]).toBeLessThan(13.4);
  expect(bounds[2]).toBeGreaterThan(13.5);
});

test('saved German office addresses become street and postal-city lines without guessing custom labels', () => {
  const original =
    '14, Rudolfplatz, Mauritiusviertel, Altstadt-Süd, Innenstadt, Köln, Nordrhein-Westfalen, 50674, Deutschland';
  expect(compactLocationLabel(original)).toBe('Rudolfplatz 14, 50674 Köln, Deutschland');
  expect(officeAddressDisplay(original)).toBe('Rudolfplatz 14\n50674 Köln');
  expect(officeAddressDisplay('Rudolfplatz 14, 50674 Köln, Deutschland')).toBe(
    'Rudolfplatz 14\n50674 Köln',
  );
  expect(officeAddressDisplay('Office, Floor 2, Berlin')).toBe('Office, Floor 2, Berlin');
  expect(officeAddressDisplay('Berlin office')).toBe('Berlin office');
  expect(
    compactLocationLabel(
      '14, Hauptstraße, Köln, Regierungsbezirk Köln, Nordrhein-Westfalen, 50674, Deutschland',
    ),
  ).toBe('Hauptstraße 14, 50674 Köln, Deutschland');
});
test('new address searches prefer structured street and city over administrative display names', () => {
  expect(
    normalizeLocations([
      {
        lat: '50.93',
        lon: '6.94',
        display_name: 'Very long district hierarchy',
        address: {
          road: 'Rudolfplatz',
          house_number: '14',
          postcode: '50674',
          city: 'Köln',
          suburb: 'Mauritiusviertel',
          state: 'Nordrhein-Westfalen',
          country: 'Deutschland',
          country_code: 'de',
        },
      },
    ]),
  ).toEqual([
    { label: 'Rudolfplatz 14, 50674 Köln, Deutschland', latitude: 50.93, longitude: 6.94 },
  ]);
  expect(
    normalizeLocations([
      {
        lat: '51.5',
        lon: '-0.1',
        display_name: 'London',
        address: {
          road: 'Downing Street',
          house_number: '10',
          city: 'London',
          country: 'United Kingdom',
          country_code: 'gb',
        },
      },
    ])[0].label,
  ).toBe('10 Downing Street, London, United Kingdom');
});
