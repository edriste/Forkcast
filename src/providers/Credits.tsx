import React, { createContext, useContext, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from './Locale';
import { Button, Card, Notice, useAction, useTheme } from '../components/ui';
import { cuisinePresetLicense } from '../lib/licenses';
const Context = createContext<() => void>(() => {});
export const useCredits = () => useContext(Context);
export function CreditsButton() {
  const { t } = useLocale();
  const open = useCredits();
  return <Button secondary title={t('Credits & licenses')} onPress={open} />;
}
export function CreditsProvider({ children }: React.PropsWithChildren) {
  const { t } = useLocale();
  const { colors, styles } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const padding = Math.max(insets.top, insets.bottom) + 16;
  const [open, setOpen] = useState(false);
  const action = useAction();
  const close = () => setOpen(false);
  function link(label: string, url: string) {
    return (
      <Pressable
        key={url}
        accessibilityRole="link"
        onPress={() => action.run(() => Linking.openURL(url))}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[styles.text, { color: colors.accent, textDecorationLine: 'underline' }]}>
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Context.Provider
      value={() => {
        action.setError('');
        setOpen(true);
      }}
    >
      {children}
      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={close}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: padding,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Dismiss credits')}
            onPress={close}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          />
          <View
            role="dialog"
            aria-modal
            accessibilityViewIsModal
            accessibilityLabel={t('Credits & licenses')}
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: height - padding * 2,
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderWidth: 1,
              borderRadius: 20,
              padding: 16,
              gap: 12,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <Text accessibilityRole="header" style={[styles.heading, { flex: 1 }]}>
                {t('Credits & licenses')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Close credits')}
                onPress={close}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: colors.ink, fontSize: 26 }}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 12 }}
            >
              <Card>
                <Text style={styles.heading}>{t('Place and address data')}</Text>
                <Text style={styles.text}>
                  {t(
                    'Restaurant facts and address search use OpenStreetMap data, available under the Open Database License (ODbL). Team reviews and cuisine corrections are supplied by your colleagues.',
                  )}
                </Text>
                {link(t('© OpenStreetMap contributors'), 'https://www.openstreetmap.org/copyright')}
                {link(
                  'Open Database License 1.0',
                  'https://opendatacommons.org/licenses/odbl/1-0/',
                )}
              </Card>
              <Card>
                <Text style={styles.heading}>{t('Maps')}</Text>
                <Text style={styles.text}>
                  {t(
                    'Map tiles are provided by OpenFreeMap using the OpenMapTiles schema and OpenStreetMap data. Maps are displayed with MapLibre.',
                  )}
                </Text>
                {link('OpenFreeMap', 'https://openfreemap.org/')}
                {link('© OpenMapTiles', 'https://openmaptiles.org/')}
                {link('MapLibre', 'https://maplibre.org/')}
              </Card>
              <Card>
                <Text style={styles.heading}>{t('Walking routes')}</Text>
                <Text style={styles.text}>
                  {t(
                    'Walking distances use openrouteservice by HeiGIT and OpenStreetMap data. Route availability depends on mapped footpaths and access restrictions.',
                  )}
                </Text>
                {link('© openrouteservice.org by HeiGIT', 'https://openrouteservice.org/')}
              </Card>
              <Card>
                <Text style={styles.heading}>{t('Cuisine presets')}</Text>
                <Text style={styles.text}>
                  {t(
                    'Cuisine choices use the OpenStreetMap iD tagging schema, licensed under the ISC License.',
                  )}
                </Text>
                {link(
                  'OpenStreetMap iD tagging schema',
                  'https://github.com/openstreetmap/id-tagging-schema',
                )}
                <Text selectable style={[styles.subtitle, { fontSize: 12 }]}>
                  {cuisinePresetLicense}
                </Text>
              </Card>
              <Notice error={action.error} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Context.Provider>
  );
}
