import { Text, View } from 'react-native';
import type { Aggregate } from '../../lib/types';
import { useLocale } from '../../providers/Locale';
import { useTheme } from '../ui';

export function RatingSummary({ aggregate }: { aggregate: Aggregate }) {
  const { t, number } = useLocale();
  const { styles } = useTheme();

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.heading}>
        ★ {number(Number(aggregate.average))}{' '}
        <Text style={styles.subtitle}>
          · {aggregate.count} {aggregate.count === 1 ? t('review') : t('reviews')}
        </Text>
      </Text>
    </View>
  );
}
