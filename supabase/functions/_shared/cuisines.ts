import { OSM_ID, type Place } from './osm.ts';
import { cuisineLabel, normalizeCuisineTag } from './cuisineCatalogue.ts';
export type CuisineOverride = { cuisines: string[]; updatedAt: string };
export function parseCuisines(input: string): string[] {
  const cuisines = [...new Set(input.split(/[,;]/).map(normalizeCuisineTag).filter(Boolean))];
  if (
    !cuisines.length ||
    cuisines.length > 8 ||
    cuisines.some((value) => !/^[a-z][a-z0-9_-]{0,39}$/.test(value) || value === 'unknown')
  )
    throw new Error(
      'Select 1–8 cuisines. Custom tags can use letters, numbers, spaces, underscores or hyphens.',
    );
  return cuisines;
}
const humanize = (value: string) =>
  value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export function applyCuisineOverride(place: Place, override?: CuisineOverride): Place {
  if (place.provider !== 'osm') return place;
  const cuisines = [
    ...new Set(
      (
        override?.cuisines ??
        place.types
          .filter((type) => type.startsWith('cuisine:') && type !== 'cuisine:unknown')
          .map((type) => type.slice(8))
      ).map(normalizeCuisineTag),
    ),
  ];
  if (
    !override &&
    place.types
      .filter((type) => type.startsWith('cuisine:') && type !== 'cuisine:unknown')
      .map((type) => type.slice(8))
      .every((tag, index) => tag === cuisines[index])
  )
    return place;
  const types = place.types.filter((type) => !type.startsWith('cuisine:'));
  return {
    ...place,
    types: [
      ...types,
      ...cuisines.map((cuisine) => `cuisine:${cuisine}`),
      ...(cuisines.length ? [] : ['cuisine:unknown']),
    ],
    category: `${humanize(types[0] ?? 'restaurant')} · ${cuisines.length ? cuisines.map(cuisineLabel).join(', ') : 'Cuisine not listed'}`,
    ...(override ? { cuisineOverride: { ...override, cuisines } } : {}),
  };
}
export function osmEditUrl(place: Place): string | undefined {
  if (place.provider !== 'osm' || !OSM_ID.test(place.id)) return;
  const [, type, id] = place.id.split(':');
  const url = new URL('https://www.openstreetmap.org/edit');
  url.searchParams.set('editor', 'id');
  url.searchParams.set(type, id);
  if (
    place.latitude != null &&
    place.longitude != null &&
    Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude)
  )
    url.hash = `map=19/${place.latitude}/${place.longitude}`;
  return url.toString();
}
