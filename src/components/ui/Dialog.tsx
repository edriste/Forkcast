import type { PropsWithChildren } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { useLocale } from '../../providers/Locale';
import { useTheme } from '../../providers/Theme';
import { IconAction } from './actions';
import { SectionHeading } from './layout';
import { ModalFrame } from './ModalFrame';

export function Dialog({
  visible,
  title,
  onClose,
  busy = false,
  closeLabel,
  children,
}: PropsWithChildren<{
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
    <ModalFrame
      visible={visible}
      title={title}
      dismissLabel={closeLabel ?? t('Close lunch dialog')}
      onClose={close}
      backdropColor={'rgba(0,0,0,0.4)'}
      containerStyle={{ padding: 24 }}
      contentStyle={{
        width: Math.min(480, width - 48),
        maxHeight: height - 80,
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: 20,
        gap: 12,
      }}
      busy={busy}
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
    </ModalFrame>
  );
}
