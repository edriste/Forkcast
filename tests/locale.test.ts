import { expect, test } from 'vitest';
import de from '../src/i18n/de.json';
import { resolveLocale, translate } from '../src/i18n/translate';
import { localizedCuisineOptions } from '../src/i18n/cuisines';
import { OSM_CUISINE_LABELS } from '../supabase/functions/_shared/cuisineTags';
import { displayDate, money } from '../src/lib/format';

test('system locale follows ordered supported preferences with English fallback', () => {
  expect(resolveLocale(['de-DE'])).toEqual({ language: 'de', locale: 'de-DE' });
  expect(resolveLocale(['fr-FR', 'de_CH', 'en-US'])).toEqual({ language: 'de', locale: 'de-CH' });
  expect(resolveLocale(['en-GB', 'de-DE'])).toEqual({ language: 'en', locale: 'en-GB' });
  expect(resolveLocale(['fr-FR'])).toEqual({ language: 'en', locale: 'en-US' });
  expect(resolveLocale([])).toEqual({ language: 'en', locale: 'en-US' });
});
test('translations preserve interpolated names and unknown provider messages', () => {
  expect(translate('Organization location: {0}', 'de', { 0: 'Breakfast' })).toBe(
    'Standort der Organisation: Breakfast',
  );
  expect(translate('Select {0}', 'de', { 0: 'Breakfast' })).toBe('Breakfast auswählen');
  expect(translate('Pay {0} with PayPal', 'en', { 0: '€4.29' })).toBe('Pay €4.29 with PayPal');
  expect(translate('Unexpected upstream error', 'de')).toBe('Unexpected upstream error');
  expect(translate('Showing saved OSM data. OSM data could not be refreshed.', 'de')).toBe(
    'Gespeicherte OSM-Daten werden angezeigt. Die OSM-Daten konnten nicht aktualisiert werden.',
  );
});
test('all German translation placeholders and OSM cuisine labels are complete', () => {
  for (const [source, translated] of Object.entries(de)) {
    expect(translated.trim()).not.toBe('');
    expect(translated.match(/\{\w+\}/g)?.sort() ?? []).toEqual(
      source.match(/\{\w+\}/g)?.sort() ?? [],
    );
  }
  for (const label of Object.values(OSM_CUISINE_LABELS))
    expect(Object.hasOwn(de, label)).toBe(true);
});
test('German cuisine searches retain canonical OSM values and English aliases', () => {
  expect(localizedCuisineOptions('Italienisch', [], 'de', 'de-DE').map((x) => x.value)).toContain(
    'italian',
  );
  expect(localizedCuisineOptions('turkisch', [], 'de', 'de-DE').map((x) => x.value)).toContain(
    'turkish',
  );
  expect(localizedCuisineOptions('tex mex', [], 'de', 'de-DE').map((x) => x.value)).toContain(
    'tex-mex',
  );
  expect(
    localizedCuisineOptions('Office noodles', ['office_noodles'], 'de', 'de-DE')[0].value,
  ).toBe('office_noodles');
});
test('German display formatting does not change stored cents or ISO dates', () => {
  expect(money(429, 'de-DE')).toBe('4,29\u00a0€');
  expect(displayDate('2026-10-12', 'de-DE')).toMatch(/12\. Okt\. 2026/);
});
