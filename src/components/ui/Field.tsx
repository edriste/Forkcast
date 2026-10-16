import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../../providers/Theme';

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
