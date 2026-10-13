import React from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useLocale } from '../providers/Locale';
import { useTheme } from './ui';
import { IconAction, SectionHeading } from './compact';
export function LunchDialog({
  visible,
  title,
  onClose,
  busy = false,
  closeLabel,
  children,
}: React.PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
  closeLabel?: string;
}>) {
  const { width, height } = useWindowDimensions();
  const { colors } = useTheme();
  const { t } = useLocale();
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel ?? t('Close lunch dialog')}
          disabled={busy}
          onPress={close}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        <View
          role="dialog"
          accessibilityLabel={title}
          accessibilityViewIsModal
          style={{
            width: Math.min(480, width - 48),
            maxHeight: height - 80,
            backgroundColor: colors.surface,
            borderRadius: 24,
            padding: 20,
            gap: 12,
          }}
        >
          <SectionHeading title={title}>
            <IconAction
              title={closeLabel ?? t('Close lunch dialog')}
              icon="close-outline"
              disabled={busy}
              onPress={close}
            />
          </SectionHeading>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 12 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
