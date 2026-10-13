import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { useOrganizations } from '../providers/Organizations';
import { useNotifications } from '../providers/Notifications';
import { useSession } from '../providers/Auth';
import { useLocale } from '../providers/Locale';
import { supabase } from '../lib/supabase';
import { useResource } from '../lib/useResource';
import { useSignupClock } from '../lib/useSignupClock';
import { deadlineFields, displayDeadline, parseBerlinDeadline } from '../lib/signupDeadline';
import { parsePrice } from '../lib/payments';
import {
  emptyItem,
  groupOrderItems,
  menuUrl,
  officeOrderDetail,
  orderPaymentLink,
  orderStatusLabel,
  parseOrderItems,
  type ItemDraft,
  type OrderStatus,
} from '../lib/orders';
import {
  Button,
  Card,
  Chip,
  Field,
  Loading,
  Notice,
  Page,
  useAction,
  useTheme,
} from '../components/ui';
import { IconAction, InfoDisclosure, SectionHeading } from '../components/compact';
import { LunchDialog } from '../components/LunchDialog';
export function OrderScreen({ route }: NativeStackScreenProps<RootStackParams, 'Order'>) {
  const org = useOrganizations().current!.id;
  const user = useSession().user.id;
  const notifications = useNotifications();
  const { t, money, displayDate, locale } = useLocale();
  const { styles, colors } = useTheme();
  const action = useAction();
  const resource = useResource(
    useCallback(() => officeOrderDetail(org, route.params.orderId), [org, route.params.orderId]),
    ['orders', 'organization'],
  );
  const reload = async () => {
    await Promise.all([resource.reload(), notifications.refresh()]);
  };
  const order = resource.data?.order;
  const members = resource.data?.members ?? [];
  const items = resource.data?.items ?? [];
  const mine = members.find((m) => m.user_id === user);
  const now = useSignupClock([order?.signup_deadline]);
  const canEdit = !!order && order.status === 'open' && Date.parse(order.signup_deadline) > now;
  const organizer = order?.organizer_id === user;
  const [draft, setDraft] = useState<ItemDraft[]>([emptyItem()]);
  const dirty = useRef(false);
  const draftRevision = useRef(0);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [fee, setFee] = useState('0');
  const [eta, setEta] = useState('');
  const financeDirty = useRef(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [confirmation, setConfirmation] = useState<'place' | 'cancel' | 'leave' | 'reload' | null>(
    null,
  );
  const snapshot = useRef(0);
  const [copied, setCopied] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const signature = items.map((i) => `${i.id}:${i.quantity}:${i.unit_cents}:${i.notes}`).join('|');
  useEffect(() => {
    setChecked(new Set());
    setCopied(false);
  }, [signature]);
  useEffect(() => {
    if (!resource.data) return;
    if (!dirty.current) {
      draftRevision.current = mine?.revision ?? 0;
      const own = resource.data.items.filter((i) => i.user_id === user);
      setDraft(
        own.length
          ? own.map((i) => ({
              name: i.item_name,
              quantity: String(i.quantity),
              price: (i.unit_cents / 100).toFixed(2),
              notes: i.notes,
            }))
          : [emptyItem()],
      );
      setReady(mine?.ready ?? false);
    }
    if (!financeDirty.current) {
      setFee((resource.data.order.delivery_fee_cents / 100).toFixed(2));
      setEta(
        resource.data.order.arrival_at ? deadlineFields(resource.data.order.arrival_at).time : '',
      );
    }
    if (!deadlineOpen) {
      const fields = deadlineFields(resource.data.order.signup_deadline);
      setDeadlineDate(fields.date);
      setDeadlineTime(fields.time);
    }
  }, [resource.data, user, mine?.ready, deadlineOpen]);
  if (resource.loading && !order) return <Loading />;
  if (!order)
    return (
      <Page>
        <Notice error={resource.error} />
        <Button title={t('Retry order')} onPress={resource.reload} />
      </Page>
    );
  const groups = groupOrderItems(items, members, t('Colleague'));
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_cents, 0);
  const placed = order.status === 'placed' || order.status === 'arrived';
  let feePreview: number | null = null;
  try {
    feePreview = parsePrice(fee);
  } catch {}
  const change = async (status: OrderStatus, additional: Record<string, unknown> = {}) => {
    const { error } = await supabase.rpc('update_office_order', {
      order_key: order.id,
      expected_version: order.version,
      new_status: status,
      ...additional,
    });
    if (error) throw error;
    await reload();
  };
  const edit = (index: number, key: keyof ItemDraft, value: string) => {
    dirty.current = true;
    setEditing(true);
    setDraft((current) =>
      current.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  };
  return (
    <Page>
      <Notice error={resource.error || action.error} />
      {action.error.toLowerCase().includes('changed') && (
        <Button
          secondary
          title={t('Load latest order')}
          onPress={() => setConfirmation('reload')}
        />
      )}
      {resource.error && <Button secondary title={t('Retry order')} onPress={resource.reload} />}
      <Card>
        <Text style={styles.badge}>
          {displayDate(order.order_date)} · {t(orderStatusLabel(order, now))}
        </Text>
        <Text style={styles.title}>{order.restaurant}</Text>
        <Text style={styles.subtitle}>
          {t('Organized by {name}', { name: order.profiles?.display_name ?? t('Colleague') })}
        </Text>
        <Text style={styles.text}>
          {order.delivery_address}
          {order.delivery_notes ? `\n${order.delivery_notes}` : ''}
        </Text>
        <Text style={styles.subtitle}>
          {t('Order deadline')}: {displayDeadline(order.signup_deadline, locale)}
        </Text>
        {order.arrival_at && (
          <Text style={styles.text}>
            {t('Expected arrival')}: {displayDeadline(order.arrival_at, locale)}
          </Text>
        )}
        <Button
          secondary
          title={t('Open menu')}
          onPress={() =>
            action.run(async () => {
              await Linking.openURL(menuUrl(order.menu_url));
            })
          }
        />
      </Card>
      {order.status !== 'cancelled' && (mine || !placed) && (
        <Card>
          <SectionHeading title={t('Your order')} />
          {mine && (
            <>
              <Text style={styles.subtitle}>
                {t(mine.ready ? 'Ready to order' : 'Still choosing')}
              </Text>
              {items
                .filter((i) => i.user_id === user)
                .map((item) => (
                  <Text key={item.id} style={styles.text}>
                    {item.quantity} × {item.item_name} · {money(item.quantity * item.unit_cents)}
                    {item.notes ? `\n${item.notes}` : ''}
                  </Text>
                ))}
            </>
          )}
          {canEdit && (editing || !mine) ? (
            <>
              <Text style={styles.subtitle}>
                {t(
                  'Adding items selects Ordering in for this date. Your choices are shared with the team.',
                )}
              </Text>
              {draft.map((item, index) => (
                <View
                  key={index}
                  style={{
                    gap: 10,
                    borderTopWidth: index ? 1 : 0,
                    borderColor: colors.line,
                    paddingTop: index ? 12 : 0,
                  }}
                >
                  <SectionHeading title={t('Item {count}', { count: index + 1 })}>
                    {draft.length > 1 && (
                      <IconAction
                        title={t('Remove item {count}', { count: index + 1 })}
                        icon="close-outline"
                        onPress={() => {
                          dirty.current = true;
                          setEditing(true);
                          setDraft((current) => current.filter((_, i) => i !== index));
                        }}
                      />
                    )}
                  </SectionHeading>
                  <Field
                    label={t('Item name {count}', { count: index + 1 })}
                    value={item.name}
                    onChangeText={(value) => edit(index, 'name', value)}
                    maxLength={120}
                  />
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t('Quantity {count}', { count: index + 1 })}
                        value={item.quantity}
                        onChangeText={(value) => edit(index, 'quantity', value)}
                        keyboardType="number-pad"
                        maxLength={3}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t('Unit price {count} (€)', { count: index + 1 })}
                        value={item.price}
                        onChangeText={(value) => edit(index, 'price', value)}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <Field
                    label={t('Special requests {count}', { count: index + 1 })}
                    value={item.notes}
                    onChangeText={(value) => edit(index, 'notes', value)}
                    maxLength={500}
                  />
                </View>
              ))}
              <Button
                secondary
                title={t('Add another item')}
                disabled={draft.length >= 50 || action.busy}
                onPress={() => {
                  dirty.current = true;
                  setEditing(true);
                  setDraft((current) => [...current, emptyItem()]);
                }}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[false, true].map((value) => (
                  <Chip
                    key={String(value)}
                    label={t(value ? 'Ready to order' : 'Still choosing')}
                    selected={ready === value}
                    onPress={() => {
                      dirty.current = true;
                      setEditing(true);
                      setReady(value);
                    }}
                  />
                ))}
              </View>
              <Button
                title={t('Save my order')}
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    const { error } = await supabase.rpc('save_office_order_items', {
                      order_key: order.id,
                      items: parseOrderItems(draft),
                      is_ready: ready,
                      expected_revision: draftRevision.current,
                    });
                    if (error) throw error;
                    dirty.current = false;
                    setEditing(false);
                    await reload();
                  })
                }
              />
            </>
          ) : (
            canEdit && (
              <Button secondary title={t('Edit my items')} onPress={() => setEditing(true)} />
            )
          )}
          {canEdit && mine && (
            <Button
              secondary
              title={t('Leave this order')}
              busy={action.busy}
              onPress={() => {
                snapshot.current = mine.revision;
                setConfirmation('leave');
              }}
            />
          )}
          {!canEdit && !placed && (
            <Text style={styles.subtitle}>{t('This order is closed for changes')}</Text>
          )}
          {placed && mine && (
            <>
              <Text style={styles.heading}>
                {t('Your total')}: {money(mine.total_cents ?? 0)}
              </Text>
              <Text style={styles.subtitle}>
                {t('Includes your equal share of the delivery fee.')}
              </Text>
              <Text style={styles.text}>
                {t(
                  mine.total_cents === 0
                    ? 'No payment needed'
                    : mine.payment_confirmed_at
                      ? 'Payment confirmed'
                      : mine.paid
                        ? 'Marked paid (self-reported)'
                        : 'Unpaid',
                )}
              </Text>
              {!mine.payment_confirmed_at && !organizer && (mine.total_cents ?? 0) > 0 && (
                <>
                  {!mine.paid && order.paypal_handle && (
                    <Button
                      title={t('Pay with PayPal')}
                      onPress={() =>
                        action.run(async () => {
                          await Linking.openURL(
                            orderPaymentLink(order.paypal_handle!, mine.total_cents!),
                          );
                        })
                      }
                    />
                  )}
                  <Button
                    secondary
                    title={t(mine.paid ? 'Undo paid mark' : 'Mark as paid')}
                    busy={action.busy}
                    onPress={() =>
                      action.run(async () => {
                        const { error } = await supabase.rpc('set_office_order_payment', {
                          order_key: order.id,
                          is_paid: !mine.paid,
                          expected_total: mine.total_cents,
                        });
                        if (error) throw error;
                        await reload();
                      })
                    }
                  />
                </>
              )}
            </>
          )}
        </Card>
      )}
      <Card>
        <SectionHeading title={t('Team order')} />
        <Text style={styles.subtitle}>
          {t('{ready} of {count} people ready', {
            ready: members.filter((m) => m.ready).length,
            count: members.length,
          })}
        </Text>
        <InfoDisclosure title={t(placed ? 'People & payments' : 'View everyone’s choices')}>
          {members.map((member) => (
            <View
              key={member.user_id}
              style={{ gap: 4, borderTopWidth: 1, borderColor: colors.line, paddingTop: 10 }}
            >
              <Text style={styles.heading}>{member.profiles?.display_name ?? t('Colleague')}</Text>
              <Text style={styles.subtitle}>
                {t(member.ready ? 'Ready to order' : 'Still choosing')}
              </Text>
              {items
                .filter((i) => i.user_id === member.user_id)
                .map((item) => (
                  <Text key={item.id} style={styles.text}>
                    {item.quantity} × {item.item_name} · {money(item.quantity * item.unit_cents)}
                    {item.notes ? ` · ${item.notes}` : ''}
                  </Text>
                ))}
              {placed && (
                <Text style={styles.text}>
                  {money(member.total_cents ?? 0)} ·{' '}
                  {t(
                    member.total_cents === 0
                      ? 'No payment needed'
                      : member.payment_confirmed_at
                        ? 'Payment confirmed'
                        : member.paid
                          ? 'Marked paid (self-reported)'
                          : 'Unpaid',
                  )}
                </Text>
              )}
              {organizer &&
                placed &&
                !member.payment_confirmed_at &&
                (member.total_cents ?? 0) > 0 && (
                  <Button
                    secondary
                    title={t('Confirm payment from {name}', {
                      name: member.profiles?.display_name ?? t('Colleague'),
                    })}
                    busy={action.busy}
                    onPress={() =>
                      action.run(async () => {
                        const { error } = await supabase.rpc('confirm_office_order_payment', {
                          order_key: order.id,
                          participant: member.user_id,
                          expected_total: member.total_cents,
                        });
                        if (error) throw error;
                        await reload();
                      })
                    }
                  />
                )}
            </View>
          ))}
        </InfoDisclosure>
        {!members.length && <Text style={styles.subtitle}>{t('No choices added yet.')}</Text>}
      </Card>
      {organizer && order.status !== 'cancelled' && (
        <Card>
          <Text style={styles.heading}>{t('Organizer checkout')}</Text>
          <Text style={styles.subtitle}>
            {t(
              'Check the items, then place the order in the restaurant’s website or delivery app.',
            )}
          </Text>
          {groups.map((group, index) => (
            <Pressable
              key={`${group.name}:${group.notes}:${index}`}
              accessibilityRole="checkbox"
              accessibilityLabel={t('{count} × {name}', {
                count: group.quantity,
                name: group.name,
              })}
              accessibilityState={{ checked: checked.has(String(index)) }}
              aria-checked={checked.has(String(index))}
              onPress={() =>
                setChecked((current) => {
                  const next = new Set(current);
                  next.has(String(index)) ? next.delete(String(index)) : next.add(String(index));
                  return next;
                })
              }
              style={{ minHeight: 44, gap: 4 }}
            >
              <Text style={styles.heading}>
                {checked.has(String(index)) ? '✓ ' : '□ '}
                {group.quantity} × {group.name}
              </Text>
              <Text style={styles.subtitle}>
                {group.people.join(', ')}
                {group.notes ? `\n${group.notes}` : ''}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.text}>
            {t('Items subtotal')}: {money(subtotal)}
          </Text>
          {placed && (
            <Text style={styles.text}>
              {t('Delivery fee')}: {money(order.delivery_fee_cents)} · {t('Grand total')}:{' '}
              {money(subtotal + order.delivery_fee_cents)}
            </Text>
          )}
          <Button
            secondary
            title={t(copied ? 'Order copied' : 'Copy combined order')}
            disabled={!groups.length}
            onPress={() =>
              action.run(async () => {
                await Clipboard.setStringAsync(
                  `${order.restaurant}\n${order.delivery_address}\n${order.delivery_notes}\n\n${groups.map((group) => `${group.quantity} × ${group.name} · ${money(group.quantity * group.price)}\n${group.people.join(', ')}${group.notes ? `\n${group.notes}` : ''}`).join('\n\n')}\n\n${t('Items subtotal')}: ${money(subtotal)}${placed ? `\n${t('Delivery fee')}: ${money(order.delivery_fee_cents)}\n${t('Grand total')}: ${money(subtotal + order.delivery_fee_cents)}` : ''}`,
                );
                setCopied(true);
              })
            }
          />
          {order.status === 'open' && (
            <Button
              title={t('Close order for changes')}
              busy={action.busy}
              onPress={() => action.run(() => change('closed'))}
            />
          )}
          {['open', 'closed'].includes(order.status) && (
            <>
              <Button
                secondary
                title={t('Change order deadline')}
                onPress={() => setDeadlineOpen(!deadlineOpen)}
              />
              {deadlineOpen && (
                <>
                  <Field
                    label={t('Deadline date (YYYY-MM-DD)')}
                    value={deadlineDate}
                    onChangeText={setDeadlineDate}
                  />
                  <Field
                    label={t('Deadline time (HH:mm)')}
                    value={deadlineTime}
                    onChangeText={setDeadlineTime}
                  />
                  <Button
                    title={t('Save deadline')}
                    busy={action.busy}
                    onPress={() =>
                      action.run(async () => {
                        await change(order.status, {
                          new_deadline: parseBerlinDeadline(deadlineDate, deadlineTime),
                        });
                        setDeadlineOpen(false);
                      })
                    }
                  />
                </>
              )}
              {order.status === 'closed' && (
                <Button
                  secondary
                  title={t('Reopen order')}
                  busy={action.busy}
                  onPress={() => action.run(() => change('open'))}
                />
              )}
              {order.status === 'closed' && (
                <>
                  <Field
                    label={t('Final delivery fee (€)')}
                    value={fee}
                    onChangeText={(value) => {
                      financeDirty.current = true;
                      setFee(value);
                    }}
                    keyboardType="decimal-pad"
                  />
                  <Field
                    label={t('Expected arrival time (HH:mm, Berlin)')}
                    value={eta}
                    onChangeText={(value) => {
                      financeDirty.current = true;
                      setEta(value);
                    }}
                    maxLength={5}
                  />
                  <Text style={styles.subtitle}>
                    {t(
                      'The delivery fee is split equally per person. Amounts are fixed when you mark the order placed.',
                    )}
                  </Text>
                  {members.some((m) => !m.ready) && (
                    <Text style={styles.subtitle}>
                      {t(
                        'Some people are still choosing. Check their choices before placing the order.',
                      )}
                    </Text>
                  )}
                  <Button
                    title={t('Mark order placed')}
                    busy={action.busy}
                    disabled={!members.length}
                    onPress={() => {
                      snapshot.current = order.version;
                      setConfirmation('place');
                    }}
                  />
                </>
              )}
              <Button
                secondary
                title={t('Cancel group order')}
                busy={action.busy}
                onPress={() => {
                  snapshot.current = order.version;
                  setConfirmation('cancel');
                }}
              />
            </>
          )}
          {order.status === 'placed' && (
            <>
              <Field
                label={t('Expected arrival time (HH:mm, Berlin)')}
                value={eta}
                onChangeText={(value) => {
                  financeDirty.current = true;
                  setEta(value);
                }}
                maxLength={5}
              />
              <Button
                secondary
                title={t('Update arrival time')}
                busy={action.busy}
                onPress={() =>
                  action.run(() =>
                    change('placed', { eta: parseBerlinDeadline(order.order_date, eta) }),
                  )
                }
              />
              <Button
                title={t('Food has arrived')}
                busy={action.busy}
                onPress={() => action.run(() => change('arrived'))}
              />
            </>
          )}
        </Card>
      )}
      <LunchDialog
        visible={confirmation !== null}
        title={t(
          confirmation === 'place'
            ? 'Confirm order placed'
            : confirmation === 'cancel'
              ? 'Cancel group order?'
              : confirmation === 'reload'
                ? 'Load latest order?'
                : 'Leave this order?',
        )}
        closeLabel={t('Close order dialog')}
        busy={action.busy}
        onClose={() => setConfirmation(null)}
      >
        <Text style={styles.text}>
          {t(
            confirmation === 'place'
              ? 'Confirm that you placed the order externally. Items and payment amounts will be locked.'
              : confirmation === 'cancel'
                ? 'Everyone’s choices remain in the cancelled order, and automatic lunch responses will be cleared.'
                : confirmation === 'reload'
                  ? 'Your unsaved choices will be replaced with the latest saved version.'
                  : 'Your items will be removed from this group order.',
          )}
        </Text>
        {confirmation === 'place' && feePreview !== null && (
          <Text style={styles.heading}>
            {t('Grand total')}: {money(subtotal + feePreview)}
          </Text>
        )}
        <Notice
          error={
            confirmation === 'place' && (feePreview === null || feePreview > 100000)
              ? 'Delivery fee must be between 0 and 1000 euros'
              : action.error
          }
        />
        <Button
          title={t('Confirm')}
          disabled={confirmation === 'place' && (feePreview === null || feePreview > 100000)}
          busy={action.busy}
          onPress={() =>
            action.run(async () => {
              if (confirmation === 'reload') {
                dirty.current = false;
                setEditing(false);
              } else if (confirmation === 'leave') {
                const { error } = await supabase.rpc('leave_office_order', {
                  order_key: order.id,
                  expected_revision: snapshot.current,
                });
                if (error) throw error;
                dirty.current = false;
                setEditing(false);
              } else {
                const { error } = await supabase.rpc('update_office_order', {
                  order_key: order.id,
                  expected_version: snapshot.current,
                  new_status: confirmation === 'place' ? 'placed' : 'cancelled',
                  ...(confirmation === 'place'
                    ? {
                        fee_cents: parsePrice(fee),
                        eta: eta.trim() ? parseBerlinDeadline(order.order_date, eta) : null,
                      }
                    : {}),
                });
                if (error) throw error;
                financeDirty.current = false;
              }
              setConfirmation(null);
              await reload();
            })
          }
        />
        <Button
          secondary
          title={t('Cancel')}
          disabled={action.busy}
          onPress={() => setConfirmation(null)}
        />
      </LunchDialog>
    </Page>
  );
}
