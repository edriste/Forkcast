import React from 'react';
import { Text } from 'react-native';
import { useOrganizations } from '../providers/Organizations';
import { useLocale } from '../providers/Locale';
import {
  formatDistance,
  hasCoordinates,
  straightLineDistance,
  type Coordinates,
} from '../lib/distance';
import { useTheme } from './ui';
export function PlaceDistance({
  place,
  showUnavailable = false,
}: {
  place: Coordinates;
  showUnavailable?: boolean;
}) {
  const org = useOrganizations().current;
  const { t, locale } = useLocale();
  const { styles } = useTheme();
  const meters = straightLineDistance(org, place);
  if (meters === null)
    return showUnavailable ? (
      <Text style={styles.subtitle}>
        {t(
          hasCoordinates(org)
            ? 'Distance unavailable for this place.'
            : 'Set an office location to calculate distances.',
        )}
      </Text>
    ) : null;
  const distance = formatDistance(meters, locale);
  return (
    <Text
      style={styles.subtitle}
      accessibilityLabel={t('Straight-line distance from office: {distance}', { distance })}
    >
      {t('{distance} · straight line', { distance })}
    </Text>
  );
}
