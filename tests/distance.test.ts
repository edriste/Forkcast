import { expect, test, vi } from 'vitest';
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
import {
  compareDistance,
  formatDistance,
  hasCoordinates,
  straightLineDistance,
  withinDistance,
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
