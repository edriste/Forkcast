import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { useOrganizations } from '../providers/Organizations';
import { useLocale } from '../providers/Locale';
import { officeOrders, orderStatusLabel } from '../lib/orders';
import { useResource } from '../lib/useResource';
import { useSignupClock } from '../lib/useSignupClock';
import { Button, Notice, useTheme } from './ui';
import { IconAction, ItemRow, SectionHeading } from './compact';
export function OrdersToday({ day }: { day: string }) {
  const org = useOrganizations().current!.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { t } = useLocale();
  const { styles } = useTheme();
  const resource = useResource(
    useCallback(() => officeOrders(org, day), [org, day]),
    ['orders', 'organization'],
  );
  const now = useSignupClock(resource.data?.map((order) => order.signup_deadline) ?? []);
  return (
    <View style={{ gap: 12 }}>
      <SectionHeading title={t('Ordering in')}>
        <IconAction
          title={t('View office orders')}
          icon="list-outline"
          onPress={() => navigation.navigate('Orders')}
        />
        <IconAction
          title={t('Start group order')}
          icon="add-outline"
          onPress={() => navigation.navigate('CreateOrder')}
        />
      </SectionHeading>
      <Notice error={resource.error} />
      {resource.error && <Button secondary title={t('Retry orders')} onPress={resource.reload} />}
      {!resource.loading && !resource.error && !resource.data?.length && (
        <Text style={styles.subtitle}>{t('No group order planned today.')}</Text>
      )}
      {resource.data?.slice(0, 3).map((order) => (
        <ItemRow
          key={order.id}
          inset
          title={order.restaurant}
          detail={t(orderStatusLabel(order, now))}
          label={t('View order from {name}', { name: order.restaurant })}
          onPress={() => navigation.navigate('Order', { orderId: order.id })}
        />
      ))}
    </View>
  );
}
