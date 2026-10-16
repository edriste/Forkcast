import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignupClock } from '../../lib/useSignupClock';
import { useLocale } from '../../providers/Locale';
import { useNotifications } from '../../providers/Notifications';
import { Button, Empty, Notice, useAction, useTheme } from '../ui';
import { ModalFrame } from '../ui/ModalFrame';
import { CookingNotification } from './CookingNotification';
import { OrderNotification } from './OrderNotification';

export function NotificationBell({
  onOpen,
}: {
  onOpen: (eventId: string, orderId?: string) => void;
}) {
  const inbox = useNotifications();
  const now = useSignupClock(inbox.items.map((item) => item.signup_deadline));
  const { t } = useLocale();
  const { colors, styles } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const close = () => {
    action.setError('');
    setOpen(false);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Notifications: {count} unread', { count: inbox.unread })}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => {
          setOpen(true);
          void inbox.refresh();
        }}
        style={{
          minWidth: 44,
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 8,
        }}
      >
        <Ionicons name="notifications-outline" size={24} color={colors.ink} accessible={false} />
        {inbox.unread > 0 && (
          <View
            testID="notification-unread-marker"
            style={{
              position: 'absolute',
              right: 0,
              top: 2,
              minWidth: 18,
              height: 18,
              paddingHorizontal: 4,
              borderRadius: 9,
              backgroundColor: colors.orange,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.onOrange, fontSize: 10, fontWeight: '700' }}>
              {inbox.unread > 99 ? '99+' : inbox.unread}
            </Text>
          </View>
        )}
      </Pressable>
      <ModalFrame
        visible={open}
        title={t('Notifications')}
        dismissLabel={t('Close notifications')}
        onClose={close}
        containerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        }}
        contentStyle={{
          width: '100%',
          maxWidth: 480,
          maxHeight: height - insets.top - insets.bottom - 32,
          borderRadius: 20,
          padding: 16,
          gap: 12,
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderWidth: 1,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text accessibilityRole="header" style={styles.heading}>
            {t('Notifications')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Close notifications')}
            onPress={close}
            style={{
              minWidth: 44,
              minHeight: 44,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons name="close" size={24} color={colors.ink} />
          </Pressable>
        </View>
        <Notice error={inbox.error || action.error} />
        {inbox.items.some(
          (item) =>
            item.kind !== 'payment_due' && item.kind !== 'order_payment_due' && !item.read_at,
        ) && (
          <Button
            secondary
            title={t('Mark all as read')}
            busy={action.busy}
            onPress={() => action.run(inbox.readAll)}
          />
        )}
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {inbox.loading ? (
            <Text style={styles.subtitle}>{t('Loading notifications…')}</Text>
          ) : (
            !inbox.items.length &&
            !inbox.error && (
              <Empty
                title={t('You’re all caught up')}
                detail={t('Cooking invitations and payment updates will appear here.')}
              />
            )
          )}
          {inbox.items.map((item) =>
            item.order_id ? (
              <OrderNotification key={item.id} item={item} onOpen={onOpen} onClose={close} />
            ) : (
              <CookingNotification
                key={item.id}
                item={item}
                now={now}
                action={action}
                onOpen={onOpen}
                onClose={close}
              />
            ),
          )}
        </ScrollView>
        {inbox.items.length === 100 && (
          <Text style={styles.subtitle}>{t('Showing the latest 100 notifications.')}</Text>
        )}
        {inbox.error && (
          <Button
            secondary
            title={t('Retry notifications')}
            busy={action.busy || inbox.loading}
            onPress={() => action.run(inbox.refresh)}
          />
        )}
      </ModalFrame>
    </>
  );
}
