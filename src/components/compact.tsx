import React, { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './ui';

type Icon = ComponentProps<typeof Ionicons>['name'];
export function IconAction({
  title,
  icon,
  onPress,
  busy = false,
  disabled = false,
  selected = false,
}: {
  title: string;
  icon: Icon;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, selected }}
      aria-disabled={disabled || busy}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 15,
        backgroundColor: selected ? colors.orange : colors.light,
        opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed && !disabled && !busy ? 0.94 : 1 }],
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Ionicons
          name={icon}
          size={22}
          color={selected ? colors.onOrange : colors.accent}
          accessible={false}
        />
      )}
    </Pressable>
  );
}
export function SectionHeading({
  title,
  large = false,
  children,
}: React.PropsWithChildren<{ title: string; large?: boolean }>) {
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
}: React.PropsWithChildren<{
  title: string;
  detail: string;
  label: string;
  onPress: () => void;
  icon?: Icon;
  summary?: React.ReactNode;
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
export function InfoDisclosure({ title, children }: React.PropsWithChildren<{ title: string }>) {
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
