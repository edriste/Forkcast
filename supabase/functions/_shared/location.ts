export type OfficeLocation = { label: string; latitude: number; longitude: number };
export function normalizeLocations(input: unknown): OfficeLocation[] {
  if (!Array.isArray(input)) throw new Error('Location lookup returned an invalid response.');
  return input
    .flatMap((value) => {
      const latitude = Number(value?.lat);
      const longitude = Number(value?.lon);
      const label =
        typeof value?.display_name === 'string' ? value.display_name.trim().slice(0, 500) : '';
      return label &&
        value.lat != null &&
        value.lon != null &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180
        ? [{ label, latitude, longitude }]
        : [];
    })
    .slice(0, 5);
}
