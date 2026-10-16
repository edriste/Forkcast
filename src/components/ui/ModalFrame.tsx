import type { PropsWithChildren } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type ModalFrameProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  dismissLabel: string;
  onClose: () => void;
  busy?: boolean;
  backdropColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function ModalFrame({
  visible,
  title,
  dismissLabel,
  onClose,
  busy = false,
  backdropColor = 'rgba(0,0,0,0.55)',
  containerStyle,
  contentStyle,
  children,
}: ModalFrameProps) {
  function close() {
    if (!busy) onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.container, containerStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          disabled={busy}
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]}
        />
        <View
          role="dialog"
          aria-modal
          accessibilityLabel={title}
          accessibilityViewIsModal
          style={contentStyle}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
