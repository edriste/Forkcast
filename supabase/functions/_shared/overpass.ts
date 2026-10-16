import { OSM_RADIUS_METERS } from './osm.ts';

/** Restrict the indexed search before applying Overpass's more costly radius filter. */
export function restaurantQuery(latitude: number, longitude: number) {
  // 110 km per degree conservatively encloses the circle on WGS84. Use the
  // furthest latitude for longitude padding so the box cannot clip its edge.
  const latitudePadding = OSM_RADIUS_METERS / 110000;
  const furthestLatitude = Math.abs(latitude) + latitudePadding;
  const longitudePadding =
    OSM_RADIUS_METERS / (110000 * Math.cos((furthestLatitude * Math.PI) / 180));
  // Keep the existing radius-only query near poles or across the date line.
  const bbox =
    furthestLatitude < 85 && Math.abs(longitude) + longitudePadding < 180
      ? `[bbox:${latitude - latitudePadding},${longitude - longitudePadding},${latitude + latitudePadding},${longitude + longitudePadding}]`
      : '';
  const around = `around:${OSM_RADIUS_METERS},${latitude},${longitude}`;
  return `[out:json][timeout:25][maxsize:16777216]${bbox};(nwr["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]["name"](${around});nwr["shop"="bakery"]["name"](${around}););out center tags;`;
}
