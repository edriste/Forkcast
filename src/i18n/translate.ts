import de from './de.json';
export type Language = 'en' | 'de';
export type Params = Record<string, string | number>;
export function resolveLocale(tags: string[]) {
  for (const raw of tags) {
    const locale = raw.replace(/_/g, '-');
    const language = locale.split('-')[0].toLowerCase();
    if (language === 'de' || language === 'en') return { language: language as Language, locale };
  }
  return { language: 'en' as Language, locale: 'en-US' };
}
const nestedErrors = new Set([
  'Showing saved OSM data. {0}',
  '{0} The uploaded file could not be cleaned up; contact your operator.',
]);
const templates = Object.keys(de)
  .filter((key) => nestedErrors.has(key))
  .map((key) => {
    const names: string[] = [];
    const pattern = key
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1));
          return '(.*?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { key, names, regex: new RegExp(`^${pattern}$`, 's') };
  });
export function translate(message: string, language: Language, params: Params = {}): string {
  let result = message;
  if (language === 'de') {
    if (Object.hasOwn(de, message)) result = (de as Record<string, string>)[message];
    else {
      for (const template of templates) {
        const match = template.regex.exec(message);
        if (!match) continue;
        const values = Object.fromEntries(
          template.names.map((name, i) => [name, translate(match[i + 1], language)]),
        );
        return translate(template.key, language, values);
      }
    }
  }
  return result.replace(/\{(\w+)\}/g, (original, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : original,
  );
}
