export type OfficeLocation = { label: string; latitude: number; longitude: number };

const germanStates = new Set([
  'Baden-Württemberg',
  'Bayern',
  'Bavaria',
  'Berlin',
  'Brandenburg',
  'Bremen',
  'Hamburg',
  'Hessen',
  'Hesse',
  'Mecklenburg-Vorpommern',
  'Mecklenburg-Western Pomerania',
  'Niedersachsen',
  'Lower Saxony',
  'Nordrhein-Westfalen',
  'North Rhine-Westphalia',
  'Rheinland-Pfalz',
  'Rhineland-Palatinate',
  'Saarland',
  'Sachsen',
  'Saxony',
  'Sachsen-Anhalt',
  'Saxony-Anhalt',
  'Schleswig-Holstein',
  'Thüringen',
  'Thuringia',
]);
/** Conservatively tidy older German Nominatim labels without changing custom address text. */
export function compactLocationLabel(label: string): string {
  const parts = label.split(',').map((part) => part.trim());
  const postal = parts.length - 2;
  if (
    parts.length < 6 ||
    !/^(Deutschland|Germany)$/i.test(parts.at(-1) ?? '') ||
    !/^\d{5}$/.test(parts[postal]) ||
    !germanStates.has(parts[postal - 1]) ||
    !/^\d+[a-z]?(?:[-/]\d+[a-z]?)?$/i.test(parts[0])
  )
    return label;
  let city = postal - 2;
  while (city > 1 && /^(Regierungsbezirk|Landkreis|Kreis|Region|Städteregion)\b/i.test(parts[city]))
    city--;
  if (city <= 1 || !parts[1] || !parts[city]) return label;
  return `${parts[1]} ${parts[0]}, ${parts[postal]} ${parts[city]}, ${parts.at(-1)}`;
}
export function officeAddressDisplay(label: string): string {
  const compact = compactLocationLabel(label);
  const german = compact.match(/^([^,]+), (\d{5} [^,]+), (?:Deutschland|Germany)$/i);
  return german ? `${german[1]}\n${german[2]}` : compact;
}
function structuredLabel(value: {
  address?: Record<string, unknown>;
  display_name?: unknown;
}): string {
  const address = value.address;
  const text = (key: string) =>
    typeof address?.[key] === 'string' ? String(address[key]).trim() : '';
  const street = text('road') || text('pedestrian') || text('residential') || text('footway');
  const city = text('city') || text('town') || text('village') || text('municipality');
  if (street && city) {
    const number = text('house_number');
    const numberFirst = ['us', 'gb', 'au', 'ca', 'nz', 'ie', 'fr'].includes(text('country_code'));
    const line = (numberFirst ? [number, street] : [street, number]).filter(Boolean).join(' ');
    return [line, [text('postcode'), city].filter(Boolean).join(' '), text('country')]
      .filter(Boolean)
      .join(', ')
      .slice(0, 500);
  }
  return typeof value.display_name === 'string'
    ? compactLocationLabel(value.display_name.trim().slice(0, 500))
    : '';
}
export function normalizeLocations(input: unknown): OfficeLocation[] {
  if (!Array.isArray(input)) throw new Error('Location lookup returned an invalid response.');
  return input
    .flatMap((value) => {
      const latitude = Number(value?.lat);
      const longitude = Number(value?.lon);
      const label = value ? structuredLabel(value) : '';
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
