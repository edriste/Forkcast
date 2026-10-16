import { Ionicons } from '@expo/vector-icons';
import { Text } from 'react-native';
import {
  formatDistance,
  hasCoordinates,
  hasWalkingRoute,
  placeDistance,
  walkingMinutes,
  type Coordinates,
} from '../../lib/distance';
import { useLocale } from '../../providers/Locale';
import { useOrganizations } from '../../providers/Organizations';
import { useTheme } from '../ui';

export function PlaceDistance({
  place,
  showUnavailable = false,
}: {
  place: Coordinates;
  showUnavailable?: boolean;
}) {
  const org = useOrganizations().current;
  const { t, locale } = useLocale();
  const { styles, colors } = useTheme();
  const routed = hasWalkingRoute(org, place);
  const meters = placeDistance(org, place);
  if (meters === null)
    return showUnavailable || routed ? (
      <Text style={styles.subtitle}>
        {t(
          routed
            ? 'No walking route found.'
            : hasCoordinates(org)
              ? 'Distance unavailable for this place.'
              : 'Set an office location to calculate distances.',
        )}
      </Text>
    ) : null;
  const distance = formatDistance(meters, locale);
  const duration = walkingMinutes(org, place);
  if (duration !== null) {
    const minutes = new Intl.NumberFormat(locale).format(duration);
    return (
      <Text
        style={styles.subtitle}
        accessibilityLabel={t('Estimated walk from office: {minutes} min, {distance}', {
          minutes,
          distance,
        })}
      >
        <Ionicons name="walk-outline" size={16} color={colors.muted} accessible={false} />{' '}
        <Text style={{ fontWeight: '600', color: colors.ink }}>
          {t('≈ {minutes} min', { minutes })}
        </Text>
        {' · '}
        {distance}
      </Text>
    );
  }
  return (
    <Text
      style={styles.subtitle}
      accessibilityLabel={t(
        routed
          ? 'Walking distance from office: {distance}'
          : 'Straight-line distance from office: {distance}',
        { distance },
      )}
    >
      {t(routed ? '{distance} · walk' : '{distance} · straight line', { distance })}
    </Text>
  );
}
