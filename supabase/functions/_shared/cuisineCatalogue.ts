import { OSM_CUISINE_LABELS } from './cuisineTags.ts';

const normalize = (value: string) =>
  value
    .trim()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '_');
const aliases = new Map<string, string>();
for (const [tag, label] of Object.entries(OSM_CUISINE_LABELS)) {
  aliases.set(normalize(tag).replace(/-/g, '_'), tag);
  aliases.set(normalize(label).replace(/-/g, '_'), tag);
}
aliases.set('burgers', 'burger');
aliases.set('donuts', 'donut');
export function normalizeCuisineTag(input: string): string {
  const value = normalize(input);
  return aliases.get(value.replace(/-/g, '_')) ?? value;
}
export function cuisineLabel(value: string): string {
  const tag = normalizeCuisineTag(value);
  return Object.hasOwn(OSM_CUISINE_LABELS, tag)
    ? OSM_CUISINE_LABELS[tag]
    : tag.replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}
export function isEstablishedCuisine(value: string): boolean {
  return Object.hasOwn(OSM_CUISINE_LABELS, normalizeCuisineTag(value));
}
export function searchCuisineOptions(query: string, selected: string[] = []) {
  const values = [
    ...new Set([...Object.keys(OSM_CUISINE_LABELS), ...selected.map(normalizeCuisineTag)]),
  ];
  const tokens = normalize(query).replace(/[_-]/g, ' ').split(/\s+/).filter(Boolean);
  return values
    .map((value) => ({
      value,
      label: cuisineLabel(value),
      established: isEstablishedCuisine(value),
    }))
    .filter((option) =>
      tokens.every((token) =>
        normalize(`${option.label} ${option.value}`).replace(/[_-]/g, ' ').includes(token),
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
}
