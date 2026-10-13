import { useLocale } from '../providers/Locale';
import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import type { OfficeLocation } from '../lib/types';
import { placesRequest } from '../lib/places';
import { Button, Field, Notice, useAction, useTheme } from './ui';
import { ReviewedMap } from './ReviewedMap';
import { OSMAttribution } from './OSMAttribution';
const noPlaces: [] = [];

export function OfficeLocationPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: OfficeLocation | null;
  onChange: (value: OfficeLocation | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();

  const { styles } = useTheme();

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<OfficeLocation[]>([]);
  const [searched, setSearched] = useState(false);
  const version = useRef(0);
  const action = useAction();
  return (
    <>
      <Field
        label={t('Organization address or area')}
        value={query}
        editable={!disabled}
        placeholder={t('Office address, city, country')}
        maxLength={160}
        onChangeText={(text) => {
          version.current++;
          setQuery(text);
          setMatches([]);
          setSearched(false);
          onChange(null);
        }}
      />
      <Button
        secondary
        title={t('Find organization location')}
        disabled={disabled || query.trim().length < 3}
        busy={action.busy}
        onPress={() =>
          action.run(async () => {
            const requestVersion = version.current;
            const result = await placesRequest<{ locations: OfficeLocation[] }>(undefined, {
              action: 'locations',
              query: query.trim(),
            });
            if (requestVersion !== version.current) return;
            setMatches(result.locations);
            setSearched(true);
          })
        }
      />
      <Notice error={action.error} />
      {searched && matches.length === 0 && (
        <Text style={styles.subtitle}>
          {t('No locations found. Try a street address with city and country.')}
        </Text>
      )}
      {matches.map((location, index) => (
        <Button
          key={`${location.latitude}:${location.longitude}:${index}`}
          secondary
          disabled={disabled}
          title={t('Select {0}', { 0: location.label })}
          onPress={() => {
            onChange(location);
            setMatches([]);
            setSearched(false);
          }}
        />
      ))}
      {value ? (
        <>
          <Text style={styles.text}>
            {t('Selected location:')} {value.label}
          </Text>
          <Text style={styles.subtitle}>
            {t(
              'Tap the map to fine-tune the office pin. Nearby lunch search covers 3 km around this point.',
            )}
          </Text>
          <ReviewedMap
            places={noPlaces}
            office={{ name: t('Organization location'), ...value }}
            onPick={
              disabled
                ? undefined
                : (latitude, longitude) =>
                    onChange({
                      ...value,
                      latitude,
                      longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
                    })
            }
          />
          <Text style={styles.subtitle}>
            {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
          </Text>
        </>
      ) : (
        <Text style={styles.subtitle}>
          {t('Search and select a location to put your organization on the map.')}
        </Text>
      )}
      {!value && matches.length > 0 && <OSMAttribution />}
    </>
  );
}
