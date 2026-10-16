export type WalkingRoute = {
  originLatitude: number;
  originLongitude: number;
  latitude: number;
  longitude: number;
  meters: number | null;
  seconds: number | null;
};
import { cuisineLabel, normalizeCuisineTag } from './cuisineCatalogue.ts';
export type Place = {
  id: string;
  provider: 'osm' | 'google_legacy';
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  category: string;
  hours: string[];
  website?: string;
  mapsUrl?: string;
  updatedAt?: string;
  walking?: WalkingRoute;
  cuisineOverride?: { cuisines: string[]; updatedAt: string };
};
export type OSMElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
export const OSM_ID = /^osm:(node|way|relation):[1-9]\d{0,18}$/;
export const OSM_RADIUS_METERS = 3000;
export const CACHE_DAYS = 30;
export function safeWebsite(input?: string): string | undefined {
  if (!input) return;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.') ||
      /\s/.test(input) ||
      (/^[a-z]+:/i.test(input) && !/^https?:/i.test(input))
    )
      return;
    return url.toString();
  } catch {
    return;
  }
}
function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}
export function normalizeElement(element: OSMElement, updatedAt: string): Place | null {
  const tags = element.tags ?? {};
  if (
    !['node', 'way', 'relation'].includes(element.type) ||
    !Number.isSafeInteger(element.id) ||
    element.id <= 0 ||
    !tags.name?.trim()
  )
    return null;
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (
    latitude === undefined ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const amenity = tags.shop === 'bakery' ? 'bakery' : tags.amenity;
  if (!['restaurant', 'cafe', 'fast_food', 'food_court', 'bakery'].includes(amenity ?? ''))
    return null;
  const cuisines = (tags.cuisine ?? '').split(';').map(normalizeCuisineTag).filter(Boolean);
  const address = [
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: `osm:${element.type}:${element.id}`,
    provider: 'osm',
    name: tags.name.trim(),
    latitude,
    longitude,
    address: address || 'Address not listed',
    types: [
      amenity!,
      ...cuisines.map((cuisine) => `cuisine:${cuisine}`),
      ...(cuisines.length ? [] : ['cuisine:unknown']),
    ],
    category: `${humanize(amenity!)} · ${cuisines.length ? cuisines.map(cuisineLabel).join(', ') : 'Cuisine not listed'}`,
    hours: tags.opening_hours ? [tags.opening_hours] : [],
    website: safeWebsite(tags.website ?? tags['contact:website']),
    mapsUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    updatedAt,
  };
}
export function searchPlaces(places: Place[], query: string): Place[] {
  const tokens = query
    .trim()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/_/g, ' ');
  return places
    .filter((place) => {
      const text = normalize([place.name, place.category, place.address, ...place.types].join(' '));
      return tokens.every((token) => text.includes(token));
    })
    .sort(
      (a, b) =>
        Number(normalize(b.name).startsWith(tokens.join(' '))) -
          Number(normalize(a.name).startsWith(tokens.join(' '))) || a.name.localeCompare(b.name),
    )
    .slice(0, 30);
}
export function legacyPlace(id: string): Place {
  return {
    id,
    provider: 'google_legacy',
    name: `Previous entry · ${id.slice(0, 10)}`,
    address: 'Match this entry to an OpenStreetMap place',
    latitude: null,
    longitude: null,
    types: ['cuisine:unknown'],
    category: 'Previous entry',
    hours: [],
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=Restaurant&query_place_id=${encodeURIComponent(id)}`,
  };
}
export function mapBounds(
  places: { latitude: number | null; longitude: number | null }[],
): [number, number, number, number] | null {
  const located = places.filter(
    (place) =>
      place.latitude !== null &&
      place.longitude !== null &&
      Number.isFinite(place.latitude) &&
      Number.isFinite(place.longitude),
  );
  if (!located.length) return null;
  const longitudes = located.map((place) => place.longitude!);
  const latitudes = located.map((place) => place.latitude!);
  return [
    Math.min(...longitudes) - 0.002,
    Math.min(...latitudes) - 0.002,
    Math.max(...longitudes) + 0.002,
    Math.max(...latitudes) + 0.002,
  ];
}
