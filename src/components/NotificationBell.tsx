import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { OrderNotification } from './OrderNotification';
import { signupClosed } from '../lib/signupDeadline';
import { useSignupClock } from '../lib/useSignupClock';
import { useNotifications } from '../providers/Notifications';
import { useLocale } from '../providers/Locale';
import { IconAction } from './compact';
import { Button, Card, Empty, Notice, useAction, useTheme } from './ui';

export function NotificationBell({
  onOpen,
}: {
  onOpen: (eventId: string, orderId?: string) => void;
}) {
  const inbox = useNotifications();
  const now = useSignupClock(inbox.items.map((item) => item.signup_deadline));
  const { t, displayDate, money } = useLocale();
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
      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={close}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Close notifications')}
            onPress={close}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          />
          <View
            role="dialog"
            accessibilityLabel={t('Notifications')}
            accessibilityViewIsModal
            style={{
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
                  <Card key={item.id}>
                    <Text style={styles.badge}>
                      {t(
                        item.kind === 'cooking_reply'
                          ? 'Cooking discussion reply'
                          : item.kind === 'cooking_scheduled'
                            ? 'New office cooking'
                            : item.kind === 'payment_due'
                              ? 'Payment reminder'
                              : item.kind === 'payment_confirmed'
                                ? 'Payment confirmed'
                                : item.kind === 'cooking_joined'
                                  ? 'New signup'
                                  : 'Payment update',
                      )}
                      {!item.read_at ? ` · ${t('Unread')}` : ''}
                    </Text>
                    <Text style={styles.heading}>{item.title ?? t('Office lunch')}</Text>
                    <Text style={styles.subtitle}>{displayDate(item.meal_date)}</Text>
                    <Text style={styles.text}>
                      {item.kind === 'cooking_reply'
                        ? t('{name} replied in your cooking discussion.', { name: item.actor_name })
                        : item.kind === 'cooking_scheduled'
                          ? t('{name} scheduled an office lunch.', { name: item.actor_name })
                          : item.kind === 'payment_due'
                            ? t('You haven’t marked {amount} as paid for this lunch.', {
                                amount: money((item.portions ?? 0) * item.price_cents),
                              })
                            : item.kind === 'payment_confirmed'
                              ? t('{name} confirmed your {amount} payment.', {
                                  name: item.actor_name,
                                  amount: money((item.portions ?? 0) * item.price_cents),
                                })
                              : item.kind === 'cooking_joined'
                                ? t(
                                    item.portions === 1
                                      ? '{name} joined your lunch · 1 portion.'
                                      : '{name} joined your lunch · {count} portions.',
                                    { name: item.actor_name, count: item.portions ?? 0 },
                                  )
                                : t('{name} marked {amount} as paid (self-reported).', {
                                    name: item.actor_name,
                                    amount: money((item.portions ?? 0) * item.price_cents),
                                  })}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={t(
                            item.kind === 'payment_due' || item.kind === 'payment_confirmed'
                              ? 'View lunch & payment'
                              : 'View lunch',
                          )}
                          busy={action.busy}
                          onPress={() =>
                            action.run(async () => {
                              await inbox.update(item.id);
                              close();
                              onOpen(item.event_id!);
                            })
                          }
                        />
                      </View>
                      {item.kind === 'cooking_scheduled' && !signupClosed(item, now) && (
                        <IconAction
                          icon="person-add-outline"
                          title={t('Join · 1 portion')}
                          busy={action.busy}
                          onPress={() =>
                            action.run(async () => {
                              await inbox.join(item.id);
                              close();
                              onOpen(item.event_id!);
                            })
                          }
                        />
                      )}
                      {item.kind !== 'payment_due' && (
                        <IconAction
                          icon="close-outline"
                          title={t('Dismiss notification')}
                          busy={action.busy}
                          onPress={() => action.run(() => inbox.update(item.id, true))}
                        />
                      )}
                    </View>
                    {item.kind === 'cooking_scheduled' && signupClosed(item, now) && (
                      <Text style={styles.subtitle}>{t('Signup closed')}</Text>
                    )}
                  </Card>
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
          </View>
        </View>
      </Modal>
    </>
  );
}
