import { expect, test, vi } from 'vitest';
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
import {
  compareDistance,
  formatDistance,
  hasCoordinates,
  straightLineDistance,
  withinDistance,
  walkingMinutes,
} from '../src/lib/distance';
import { filterReviewed, sortReviewed, type Reviewed } from '../src/lib/reviews';
const origin = { latitude: 0, longitude: 0 };
test('great-circle distances handle known lengths, zero, antipodes and the date line', () => {
  expect(straightLineDistance(origin, origin)).toBe(0);
  expect(straightLineDistance(origin, { latitude: 0, longitude: 1 })).toBeCloseTo(111195.08, 1);
  expect(straightLineDistance(origin, { latitude: 0, longitude: 180 })).toBeCloseTo(
    Math.PI * 6371008.8,
    1,
  );
  expect(
    straightLineDistance({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }),
  ).toBeCloseTo(222.39, 1);
});
test('invalid or missing coordinates are unavailable and do not become nearby places', () => {
  for (const point of [
    null,
    {},
    { latitude: null, longitude: 0 },
    { latitude: NaN, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: Infinity, longitude: 0 },
  ]) {
    expect(hasCoordinates(point)).toBe(false);
    expect(straightLineDistance(origin, point)).toBeNull();
  }
  expect(withinDistance(origin, { latitude: null, longitude: null }, 500)).toBe(false);
  expect(withinDistance(origin, { latitude: null, longitude: null }, 0)).toBe(true);
  expect(withinDistance({}, { latitude: 1, longitude: 1 }, 500)).toBe(true);
  expect(compareDistance(origin, {}, origin)).toBeGreaterThan(0);
  expect(compareDistance(origin, {}, {})).toBe(0);
});
test('distance labels use rounded meters and localized kilometers without false walking times', () => {
  expect(formatDistance(0, 'en-US')).toBe('0 m');
  expect(formatDistance(3, 'en-US')).toBe('<10 m');
  expect(formatDistance(456, 'en-US')).toBe('460 m');
  expect(formatDistance(999, 'en-US')).toBe('1 km');
  expect(formatDistance(1234, 'en-US')).toBe('1.2 km');
  expect(formatDistance(1234, 'de-DE')).toBe('1,2 km');
  expect(() => formatDistance(NaN, 'en-US')).toThrow();
});
function reviewed(
  id: string,
  longitude: number | null,
  rating: number,
  cuisine = 'cuisine:japanese',
): Reviewed {
  return {
    place: { id, name: id, latitude: longitude === null ? null : 0, longitude, types: [cuisine] },
    aggregate: { average: rating, count: 1, place_id: id },
  } as Reviewed;
}
test('distance filters combine with cuisine/rating and sorting keeps unavailable distances last', () => {
  const places = [
    reviewed('far', 0.01, 5),
    reviewed('near', 0.002, 3),
    reviewed('unknown', null, 5),
    reviewed('other', 0.001, 4, 'cuisine:thai'),
  ];
  expect(filterReviewed(places, 'All', 0, origin, 500).map((x) => x.place.id)).toEqual([
    'near',
    'other',
  ]);
  expect(filterReviewed(places, 'cuisine:japanese', 4, origin, 500)).toHaveLength(0);
  expect(filterReviewed(places, 'All', 0, {}, 500)).toHaveLength(4);
  expect(sortReviewed(places, 'nearest', origin).map((x) => x.place.id)).toEqual([
    'other',
    'near',
    'far',
    'unknown',
  ]);
  expect(sortReviewed(places, 'rating', origin).map((x) => x.place.id)).toEqual([
    'far',
    'unknown',
    'other',
    'near',
  ]);
  expect(places[0].place.id).toBe('far');
});

test('routed walking distances drive filters and sorting, and known unreachable places are excluded', () => {
  const routed = {
    latitude: 0,
    longitude: 0.001,
    walking: {
      originLatitude: 0,
      originLongitude: 0,
      latitude: 0,
      longitude: 0.001,
      meters: 1200,
      seconds: 1000,
    },
  };
  // The river/road network can turn a nearby point into a longer walk.
  expect(straightLineDistance(origin, routed)).toBeLessThan(500);
  expect(withinDistance(origin, routed, 500)).toBe(false);
  expect(withinDistance(origin, routed, 2000)).toBe(true);
  expect(compareDistance(origin, routed, { latitude: 0, longitude: 0.005 })).toBeGreaterThan(0);
  expect(
    withinDistance(origin, { ...routed, walking: { ...routed.walking, meters: null } }, 2000),
  ).toBe(false);
  // Moving either endpoint invalidates the route immediately, before the next network reload.
  expect(withinDistance({ latitude: 0, longitude: 0.0001 }, routed, 500)).toBe(true);
  expect(withinDistance(origin, { ...routed, longitude: 0.002 }, 500)).toBe(true);
});

test('walking minutes round provider durations up and reject missing, invalid or stale route data', () => {
  const place = {
    latitude: 0,
    longitude: 0.001,
    walking: {
      originLatitude: 0,
      originLongitude: 0,
      latitude: 0,
      longitude: 0.001,
      meters: 600,
      seconds: 481,
    },
  };
  for (const [seconds, expected] of [
    [0, 0],
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
    [481, 9],
    [1000, 17],
  ])
    expect(walkingMinutes(origin, { ...place, walking: { ...place.walking, seconds } })).toBe(
      expected,
    );
  for (const seconds of [null, NaN, Infinity, -1])
    expect(walkingMinutes(origin, { ...place, walking: { ...place.walking, seconds } })).toBeNull();
  expect(walkingMinutes(origin, { latitude: 0, longitude: 0.001 })).toBeNull();
  expect(
    walkingMinutes(origin, { ...place, walking: { ...place.walking, meters: null } }),
  ).toBeNull();
  expect(walkingMinutes({ latitude: 1, longitude: 0 }, place)).toBeNull();
  expect(walkingMinutes(origin, { ...place, longitude: 0.002 })).toBeNull();
});
