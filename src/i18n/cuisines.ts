import { searchCuisineOptions } from '../../supabase/functions/_shared/cuisineCatalogue';
import { translate, type Language } from './translate';
const searchable = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_-]/g, ' ');
// Labels are translated for display/search; values stay canonical OSM tags.
export function localizedCuisineOptions(
  query: string,
  selected: string[],
  language: Language,
  locale: string,
) {
  const tokens = searchable(query).trim().split(/\s+/).filter(Boolean);
  return searchCuisineOptions('', selected)
    .map((option) => ({
      ...option,
      label: translate(option.label, language),
      englishLabel: option.label,
    }))
    .filter((option) =>
      tokens.every((token) =>
        searchable(`${option.label} ${option.englishLabel} ${option.value}`).includes(token),
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
