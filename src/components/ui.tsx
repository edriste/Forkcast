import { useLocale } from '../providers/Locale';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { message } from '../lib/supabase';

import { useTheme } from '../providers/Theme';
export { useTheme } from '../providers/Theme';

export function Page({ children }: React.PropsWithChildren) {
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
export function Card({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) {
  const { styles } = useTheme();

  return <View style={[styles.card, style]}>{children}</View>;
}
export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { colors, styles } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
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
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors, styles, dark } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        keyboardAppearance={dark ? 'dark' : 'light'}
        selectionColor={colors.orange}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && { borderColor: colors.accent, backgroundColor: colors.surface },
          props.multiline && { minHeight: 90, textAlignVertical: 'top' },
          props.style,
        ]}
      />
    </View>
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
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
