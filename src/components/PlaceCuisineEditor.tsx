import { useLocale } from '../providers/Locale';
import { localizedCuisineOptions } from '../i18n/cuisines';
import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { Place } from '../lib/types';
import { supabase } from '../lib/supabase';
import {
  cuisineLabel,
  isEstablishedCuisine,
  normalizeCuisineTag,
} from '../../supabase/functions/_shared/cuisineCatalogue';
import { osmEditUrl, parseCuisines } from '../../supabase/functions/_shared/cuisines';
import { Button, Card, Field, Notice, useAction, useTheme } from './ui';
export function PlaceCuisineEditor({
  place,
  org,
  onSaved,
  onEditOSM,
}: {
  place: Place;
  org: string;
  onSaved: (refreshOSM?: boolean) => Promise<void>;
  onEditOSM?: () => void;
}) {
  const { t, language, locale } = useLocale();

  const { styles, colors } = useTheme();

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [info, setInfo] = useState('');
  const action = useAction();
  const cuisines = place.types
    .filter((type) => type.startsWith('cuisine:') && type !== 'cuisine:unknown')
    .map((type) => normalizeCuisineTag(type.slice(8)));
  const editUrl = osmEditUrl(place);
  const options = localizedCuisineOptions(search, selected, language, locale);
  async function save(values: string[]) {
    const { error } = await supabase.rpc('set_place_cuisines', {
      org,
      osm_place_id: place.id,
      cuisines: values,
    });
    if (error) throw error;
    await onSaved(values.length === 0);
    setEditing(false);
    setInfo(
      values.length ? 'Cuisine saved for your organization.' : 'Using OpenStreetMap cuisine again.',
    );
  }
  return (
    <Card>
      <Text style={styles.heading}>{t('Cuisine')}</Text>
      <Text style={styles.text}>
        {cuisines.length
          ? cuisines.map((value) => t(cuisineLabel(value))).join(', ')
          : t('Cuisine not listed')}
      </Text>
      <Text style={styles.subtitle}>
        {place.cuisineOverride
          ? t('Cuisine supplied by your team.')
          : t('Cuisine from OpenStreetMap.')}{' '}
        {t('Team edits are visible only in this organization and survive catalogue refreshes.')}
      </Text>
      {!editing ? (
        <Button
          secondary
          title={cuisines.length ? t('Edit cuisine for your team') : t('Add cuisine for your team')}
          busy={action.busy}
          onPress={() => {
            setSelected([...new Set(cuisines)]);
            setSearch('');
            setCustom('');
            setCustomOpen(false);
            setEditing(true);
            setInfo('');
            action.setError('');
          }}
        />
      ) : (
        <>
          <Field
            label={t('Search OSM cuisines')}
            value={search}
            onChangeText={setSearch}
            editable={!action.busy}
            placeholder={t('e.g. Italian, Japanese, pizza')}
            maxLength={80}
          />
          <Text style={styles.subtitle}>
            {selected.length} {t('of 8 cuisines selected. Choose all that apply.')}
          </Text>
          {selected.length > 0 && (
            <View style={styles.row}>
              {selected.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={t('Remove {0}', { 0: t(cuisineLabel(value)) })}
                  disabled={action.busy}
                  onPress={() => setSelected((previous) => previous.filter((tag) => tag !== value))}
                  style={{
                    minHeight: 44,
                    borderRadius: 12,
                    backgroundColor: colors.light,
                    padding: 10,
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.accent, fontWeight: '600' }}>
                    {t(cuisineLabel(value))}
                    {isEstablishedCuisine(value) ? '' : t(' (custom)')} ×
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 240 }}
            contentContainerStyle={{ gap: 4 }}
          >
            {options.map((option) => {
              const checked = selected.includes(option.value);
              const disabled = action.busy || (!checked && selected.length >= 8);
              const toggle = () => {
                setInfo('');
                action.setError('');
                setSelected((previous) =>
                  checked
                    ? previous.filter((value) => value !== option.value)
                    : [...previous, option.value],
                );
              };
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="checkbox"
                  accessibilityLabel={t(option.label)}
                  accessibilityState={{ checked, disabled }}
                  disabled={disabled}
                  onPress={toggle}
                  {...(Platform.OS === 'web'
                    ? {
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if ((event.key === ' ' || event.key === 'Spacebar') && !disabled) {
                            event.preventDefault();
                            event.stopPropagation();
                            toggle();
                          }
                        },
                      }
                    : {})}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    padding: 12,
                    borderRadius: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: checked ? colors.light : colors.surface,
                    opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
                  })}
                >
                  <Text
                    style={{ color: colors.accent, fontSize: 20 }}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {checked ? '☑' : '☐'}
                  </Text>
                  <Text style={[styles.text, { flex: 1 }]}>
                    {t(option.label)}
                    {option.established ? '' : t(' (custom)')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {!options.length && (
            <Text style={styles.subtitle}>
              {t('No matching OSM cuisines. Try another name or add a custom cuisine below.')}
            </Text>
          )}
          <Button
            secondary
            title={customOpen ? t('Cancel custom cuisine') : t('Add a custom cuisine')}
            disabled={action.busy || (!customOpen && selected.length >= 8)}
            onPress={() => {
              setCustomOpen(!customOpen);
              setCustom('');
              action.setError('');
            }}
          />
          {customOpen && (
            <>
              <Text style={styles.subtitle}>
                {t(
                  'Use a listed OSM cuisine when possible. Add a custom tag only if no existing option fits.',
                )}
              </Text>
              <Field
                label={t('Custom cuisine')}
                value={custom}
                onChangeText={setCustom}
                editable={!action.busy}
                placeholder={t('One cuisine name')}
                maxLength={80}
              />
              <Button
                secondary
                title={t('Add custom tag')}
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    const values = parseCuisines(custom);
                    if (values.length !== 1) throw new Error('Add one custom cuisine at a time.');
                    const next = [...new Set([...selected, ...values])];
                    if (next.length > 8) throw new Error('Choose up to 8 cuisines.');
                    setSelected(next);
                    setCustom('');
                    setCustomOpen(false);
                    setInfo('');
                  })
                }
              />
            </>
          )}
          <Button
            title={t('Save cuisine')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                if (custom.trim())
                  throw new Error('Add the custom cuisine with Add custom tag before saving.');
                await save(parseCuisines(selected.join(';')));
              })
            }
          />
          <Button
            secondary
            title={t('Cancel cuisine edit')}
            disabled={action.busy}
            onPress={() => setEditing(false)}
          />
        </>
      )}
      {place.cuisineOverride && (
        <Button
          secondary
          title={t('Use OpenStreetMap cuisine')}
          busy={action.busy}
          onPress={() => action.run(() => save([]))}
        />
      )}
      {editUrl && (
        <>
          <Button
            secondary
            title={t('Edit on OpenStreetMap')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                onEditOSM?.();
                await Linking.openURL(editUrl);
              })
            }
          />
          <Text style={styles.subtitle}>
            {t(
              'Opens OSM’s editor. An OSM account is required; you review and publish any public changes there. Forkcast checks for your changes when you return. OSM changes can take time to reach its read servers.',
            )}
          </Text>
        </>
      )}
      <Notice error={action.error} />
      {info && <Text style={styles.text}>{t(info)}</Text>}
    </Card>
  );
}
