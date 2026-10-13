import { expect, test } from 'vitest';
import { normalizeLocations } from '../supabase/functions/_shared/location';
import { mapBounds } from '../supabase/functions/_shared/osm';
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
