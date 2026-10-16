import { Linking, Platform, Pressable, Text, View } from 'react-native';
import type { Place } from '../../lib/types';
import { useCredits } from '../../providers/Credits';
import { useLocale } from '../../providers/Locale';
import { Notice, useAction, useTheme } from '../ui';

export function OSMAttribution({
  maps = false,
  places = [],
}: {
  maps?: boolean;
  places?: Place[];
}) {
  const { t } = useLocale();
  const { styles } = useTheme();

  const action = useAction();
  const openCredits = useCredits();
  const links = maps
    ? [
        [t('© OpenStreetMap contributors'), 'https://www.openstreetmap.org/copyright'],
        [t('© OpenMapTiles'), 'https://openmaptiles.org/'],
      ]
    : [[t('Data: OpenStreetMap'), 'https://www.openstreetmap.org/copyright']];
  if (places.some((place) => place.dataSource === 'geoapify'))
    links.push([t('Powered by Geoapify'), 'https://www.geoapify.com/']);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {links.map(([label, url]) => (
        <Pressable
          {...(Platform.OS === 'web'
            ? { href: url, target: '_blank', rel: 'noopener noreferrer' }
            : {})}
          accessibilityRole="link"
          key={url}
          style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() =>
            action.run(async () => {
              await Linking.openURL(url);
            })
          }
        >
          <Text style={[styles.subtitle, { fontSize: 12, textDecorationLine: 'underline' }]}>
            {label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={openCredits}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[styles.subtitle, { fontSize: 12, textDecorationLine: 'underline' }]}>
          {t('Credits & licenses')}
        </Text>
      </Pressable>
      <Notice error={action.error} />
    </View>
  );
}
