import { Ionicons } from '@expo/vector-icons';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocale } from '../../providers/Locale';
import { useTheme } from '../../providers/Theme';
import { Card } from './layout';

export function Notice({ error }: { error?: string }) {
  const { t } = useLocale();
  const { styles } = useTheme();

  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {t(error)}
    </Text>
  ) : null;
}

export function Loading() {
  const { t } = useLocale();
  const { colors, styles } = useTheme();

  return (
    <View style={[styles.page, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={[styles.subtitle, { marginTop: 12 }]}>{t('Getting things ready…')}</Text>
    </View>
  );
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  const { styles } = useTheme();

  return (
    <Card>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.subtitle}>{detail}</Text>
    </Card>
  );
}

export function InfoDisclosure({ title, children }: PropsWithChildren<{ title: string }>) {
  const { colors, styles } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: open ? 8 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={colors.muted}
          accessible={false}
        />
        <Text style={[styles.text, { color: colors.muted, flex: 1 }]}>{title}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.muted}
          accessible={false}
        />
      </Pressable>
      {open && children}
    </View>
  );
}
