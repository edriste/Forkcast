import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { useTheme } from '../../providers/Theme';

type Icon = ComponentProps<typeof Ionicons>['name'];

export function Button({
  title,
  accessibilityLabel,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
}: {
  title: string;
  accessibilityLabel?: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { colors, styles } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && { backgroundColor: colors.light },
        {
          opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !disabled && !busy ? 0.98 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.accent : colors.onOrange} />
      ) : (
        <Text
          style={{
            color: secondary ? colors.accent : colors.onOrange,
            fontWeight: '700',
            fontSize: 15,
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: selected ? colors.orange : colors.light,
        padding: 12,
        borderRadius: 24,
        minHeight: 44,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: selected ? colors.onOrange : colors.ink, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

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
