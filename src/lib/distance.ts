import type { WalkingRoute } from '../../supabase/functions/_shared/osm';
export type Coordinates = {
  latitude?: number | null;
  longitude?: number | null;
  walking?: WalkingRoute;
};
export function hasCoordinates(point: Coordinates | null | undefined): boolean {
  return (
    !!point &&
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}
/** Great-circle distance in meters; missing/invalid coordinates never become zero. */
export function straightLineDistance(
  origin: Coordinates | null | undefined,
  destination: Coordinates | null | undefined,
): number | null {
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) return null;
  const radians = Math.PI / 180;
  const dLat = (destination!.latitude! - origin!.latitude!) * radians;
  const dLon = (destination!.longitude! - origin!.longitude!) * radians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(origin!.latitude! * radians) *
      Math.cos(destination!.latitude! * radians) *
      Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
/** Routes are usable only for the exact office and destination they were calculated for. */
export function hasWalkingRoute(origin: Coordinates | null | undefined, destination: Coordinates) {
  const route = destination.walking;
  return (
    !!route &&
    hasCoordinates(origin) &&
    hasCoordinates(destination) &&
    route.originLatitude === origin!.latitude &&
    route.originLongitude === origin!.longitude &&
    route.latitude === destination.latitude &&
    route.longitude === destination.longitude &&
    (route.meters === null || (Number.isFinite(route.meters) && route.meters >= 0))
  );
}
export function placeDistance(
  origin: Coordinates | null | undefined,
  destination: Coordinates,
): number | null {
  return hasWalkingRoute(origin, destination)
    ? destination.walking!.meters
    : straightLineDistance(origin, destination);
}
/** Use the provider's duration only; never infer a walk from a straight-line estimate. */
export function walkingMinutes(
  origin: Coordinates | null | undefined,
  destination: Coordinates,
): number | null {
  const seconds = destination.walking?.seconds;
  if (
    !hasWalkingRoute(origin, destination) ||
    destination.walking!.meters === null ||
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    return null;
  return Math.ceil(seconds / 60);
}
export function formatDistance(meters: number, locale: string): string {
  if (!Number.isFinite(meters) || meters < 0)
    throw new Error('Distance must be finite and nonnegative');
  if (meters > 0 && meters < 10) return '<10 m';
  const rounded = Math.round(meters / 10) * 10;
  return rounded >= 1000
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rounded / 1000)} km`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(rounded)} m`;
}
export function withinDistance(
  origin: Coordinates,
  destination: Coordinates,
  maximum: number,
): boolean {
  if (!maximum || !hasCoordinates(origin)) return true;
  const meters = placeDistance(origin, destination);
  return meters !== null && meters <= maximum;
}
export function compareDistance(origin: Coordinates, a: Coordinates, b: Coordinates): number {
  const first = placeDistance(origin, a);
  const second = placeDistance(origin, b);
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return first - second;
}
