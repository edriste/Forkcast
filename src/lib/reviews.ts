import { compareDistance, withinDistance, type Coordinates } from './distance';
import { supabase } from './supabase';
import { details } from './places';
import type { Place } from './types';
import type { Aggregate, Review } from './types';
import { cuisineLabel } from '../../supabase/functions/_shared/cuisineCatalogue';
export type Reviewed = { place: Place; aggregate: Aggregate };
export async function reviewedPlaces(org: string) {
  const aggregates: Aggregate[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('place_ratings')
      .select('*')
      .eq('organization_id', org)
      .order('place_id')
      .range(offset, offset + 499);
    if (error) throw error;
    aggregates.push(...data);
    if (data.length < 500) break;
  }
  if (!aggregates.length) return { places: [] as Reviewed[], failed: [] as string[], warning: '' };
  const result = await details(
    org,
    aggregates.map((item) => item.place_id),
  );
  const byId = new Map(aggregates.map((aggregate) => [aggregate.place_id, aggregate]));
  return {
    places: result.places
      .map((place) => ({ place, aggregate: byId.get(place.id)! }))
      .sort((a, b) => b.aggregate.average - a.aggregate.average),
    failed: result.failed,
    warning: result.warning,
  };
}
export async function placeReviews(org: string, id: string, page = 0): Promise<Review[]> {
  const { data, error } = await supabase
    .from('current_reviews')
    .select('*,profiles!author_id(id,display_name)')
    .eq('organization_id', org)
    .eq('place_id', id)
    .order('created_at', { ascending: false })
    .order('id')
    .range(page * 20, page * 20 + 19);
  if (error) throw error;
  return data as unknown as Review[];
}
export async function ownReview(org: string, id: string, author: string): Promise<Review | null> {
  const { data, error } = await supabase
    .from('current_reviews')
    .select('*')
    .eq('organization_id', org)
    .eq('place_id', id)
    .eq('author_id', author)
    .maybeSingle();
  if (error) throw error;
  return data as Review | null;
}
export function filterReviewed(
  places: Reviewed[],
  category: string,
  minimum: number,
  origin?: Coordinates,
  maximumDistance = 0,
) {
  return places.filter(
    ({ place, aggregate }) =>
      (category === 'All' || place.types.includes(category)) &&
      aggregate.average >= minimum &&
      (!origin || withinDistance(origin, place, maximumDistance)),
  );
}
export function categoryName(category: string) {
  if (category === 'cuisine:unknown') return 'Unknown cuisine';
  if (category.startsWith('cuisine:')) return cuisineLabel(category.slice(8));
  return category
    .replace(/^cuisine:/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
export function categories(places: Reviewed[]) {
  return [
    ...new Set(
      places.flatMap(({ place }) =>
        place.types.filter(
          (type) =>
            type.startsWith('cuisine:') ||
            ['cafe', 'bakery', 'fast_food', 'food_court'].includes(type),
        ),
      ),
    ),
  ].sort();
}

export function sortReviewed(places: Reviewed[], sort: 'rating' | 'nearest', origin: Coordinates) {
  return [...places].sort(
    (a, b) =>
      (sort === 'nearest' ? compareDistance(origin, a.place, b.place) : 0) ||
      Number(b.aggregate.average) - Number(a.aggregate.average) ||
      a.place.name.localeCompare(b.place.name) ||
      a.place.id.localeCompare(b.place.id),
  );
}
