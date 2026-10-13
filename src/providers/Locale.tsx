import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getLocales, useLocales } from 'expo-localization';
import { translate, resolveLocale, type Params } from '../i18n/translate';
import { displayDate as formatDate, money as formatMoney } from '../lib/format';
import type { Place } from '../lib/types';
import { cuisineLabel } from '../../supabase/functions/_shared/cuisineCatalogue';
function makeLocale(tags: string[]) {
  const { language, locale } = resolveLocale(tags);
  const t = (message: string, params?: Params) => translate(message, language, params);
  return {
    language,
    locale,
    t,
    money: (cents: number) => formatMoney(cents, locale),
    displayDate: (date: string) => formatDate(date, locale),
    date: (date: string) => new Date(date).toLocaleDateString(locale),
    number: (value: number) =>
      new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        value,
      ),
    placeCategory: (place: Place) => {
      if (language === 'en') return place.category;
      if (place.provider === 'google_legacy') return t('Previous entry');
      const amenity = place.types.find((type) => !type.startsWith('cuisine:')) ?? 'restaurant';
      const title = t(amenity.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()));
      const cuisines = place.types
        .filter((type) => type.startsWith('cuisine:') && type !== 'cuisine:unknown')
        .map((type) => t(cuisineLabel(type.slice(8))));
      return `${title} · ${cuisines.length ? cuisines.join(', ') : t('Cuisine not listed')}`;
    },
  };
}
const Context = createContext(makeLocale(['en-US']));
export function useLocale() {
  return useContext(Context);
}
export function LocaleProvider({ children }: React.PropsWithChildren) {
  const preferred = useLocales();
  const [foreground, setForeground] = useState<string[] | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForeground(getLocales().map((locale) => locale.languageTag));
    });
    return () => subscription.remove();
  }, []);
  // useLocales also listens to browser languagechange and native locale events.
  useEffect(() => setForeground(null), [preferred]);
  const tags = foreground ?? preferred.map((locale) => locale.languageTag);
  const value = useMemo(() => makeLocale(tags), [tags.join('|')]);
  useEffect(() => {
    if (Platform.OS === 'web') document.documentElement.lang = value.language;
  }, [value.language]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
