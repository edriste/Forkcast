import { expect, test } from 'vitest';
import { restaurantLeaders } from '../src/lib/lunchPlan';
import type { Place } from '../src/lib/types';
const option = (id: string, votes: number) => ({ place: { id } as Place, votes });
test('restaurant plans have no leader before votes, preserve ties and select the unique leader', () => {
  expect(restaurantLeaders([])).toEqual([]);
  expect(restaurantLeaders([option('a', 0), option('b', 0)])).toEqual([]);
  expect(
    restaurantLeaders([option('a', 2), option('b', 2), option('c', 1)]).map((x) => x.place.id),
  ).toEqual(['a', 'b']);
  expect(restaurantLeaders([option('a', 2), option('b', 3)]).map((x) => x.place.id)).toEqual(['b']);
});
