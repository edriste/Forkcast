import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../providers/Theme';

type Icon = ComponentProps<typeof Ionicons>['name'];

export function Page({ children }: PropsWithChildren) {
  const { styles } = useTheme();

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const { styles } = useTheme();

  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeading({
  title,
  large = false,
  children,
}: PropsWithChildren<{ title: string; large?: boolean }>) {
  const { styles } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text accessibilityRole="header" style={[large ? styles.title : styles.heading, { flex: 1 }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function ItemRow({
  title,
  detail,
  label,
  onPress,
  icon,
  summary,
  inset = false,
  children,
}: PropsWithChildren<{
  title: string;
  detail: string;
  label: string;
  onPress: () => void;
  icon?: Icon;
  summary?: ReactNode;
  inset?: boolean;
}>) {
  const { colors, styles } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: inset ? 0 : 16,
        paddingVertical: inset ? 10 : 16,
        backgroundColor: inset ? 'transparent' : colors.surface,
        borderWidth: inset ? 0 : 1,
        borderColor: colors.line,
        borderRadius: inset ? 0 : 20,
        boxShadow: inset ? 'none' : '0 3px 14px rgba(20, 28, 38, 0.035)',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {icon && (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              backgroundColor: colors.light,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={22} color={colors.accent} accessible={false} />
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heading} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.text} numberOfLines={2}>
            {detail}
          </Text>
          {summary}
        </View>
        {!children && (
          <Ionicons name="chevron-forward" size={20} color={colors.muted} accessible={false} />
        )}
      </Pressable>
      {children}
    </View>
  );
}
