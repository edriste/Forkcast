import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { parseRelease, watchWebUpdates } from '../../lib/webUpdates';
import { useLocale } from '../../providers/Locale';
import { useTheme } from '../../providers/Theme';

declare global {
  var __FORKCAST_BUILD__: string | undefined;
}

export function AppUpdateNotice() {
  const { t } = useLocale();
  const { colors, styles } = useTheme();
  const [release, setRelease] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const current = parseRelease({ version: globalThis.__FORKCAST_BUILD__ });
    if (current) return watchWebUpdates(current, setRelease);
  }, []);
  if (!release || release === dismissed) return null;
  return (
    <View style={{ backgroundColor: colors.light, borderBottomWidth: 1, borderColor: colors.line }}>
      <View
        style={{
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
          paddingHorizontal: 18,
          paddingVertical: 10,
          gap: 4,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="refresh-outline" size={20} color={colors.accent} />
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.text, { fontWeight: '700', flex: 1 }]}
          >
            {t('An update is available')}
          </Text>
        </View>
        <Text style={styles.text}>
          {t('Reload when you are ready. Unfinished changes will be lost.')}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDismissed(release)}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 }}
          >
            <Text style={styles.text}>{t('Later')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => window.location.reload()}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: colors.orange,
            }}
          >
            <Text style={[styles.text, { color: colors.onOrange, fontWeight: '700' }]}>
              {t('Reload app')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
