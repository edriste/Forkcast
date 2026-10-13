import { MealFlagBadges } from '../components/MealFlags';
import { SignupDeadlineBadge } from '../components/SignupDeadline';
import { useLocale } from '../providers/Locale';
import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { useOrganizations } from '../providers/Organizations';
import { IconAction, ItemRow } from '../components/compact';
import { events } from '../lib/cooking';
import { useResource } from '../lib/useResource';
import { Button, Chip, Empty, Loading, Notice, Page, useAction, useTheme } from '../components/ui';
export function CookingScreen() {
  const { t, money, displayDate } = useLocale();

  const { styles } = useTheme();

  const org = useOrganizations().current!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [past, setPast] = useState(false);
  const pages = useRef(1);
  const action = useAction();
  const resource = useResource(
    useCallback(async () => {
      const result = [];
      let more = false;
      for (let page = 0; page < pages.current; page++) {
        const items = await events(org.id, past, page);
        result.push(...items);
        more = items.length === 30;
        if (!more) break;
      }
      return { items: result, more };
    }, [org.id, past]),
    ['cooking', 'organization'],
  );
  if (resource.loading && !resource.data) return <Loading />;
  return (
    <Page>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.title, { flex: 1 }]}>{t('What’s cooking?')}</Text>
        <IconAction
          title={t('Host an office lunch')}
          icon="add-outline"
          onPress={() => navigation.navigate('CreateEvent')}
        />
      </View>
      <View style={styles.row}>
        <Chip
          label={t('Upcoming')}
          selected={!past}
          onPress={() => {
            pages.current = 1;
            setPast(false);
          }}
        />
        <Chip
          label={t('Past lunches')}
          selected={past}
          onPress={() => {
            pages.current = 1;
            setPast(true);
          }}
        />
      </View>
      <Notice error={resource.error || action.error} />
      {resource.error && (
        <Button
          secondary
          title={t('Retry cooking')}
          onPress={resource.reload}
          busy={resource.loading}
        />
      )}
      {resource.data?.items.length === 0 && (
        <Empty
          title={past ? t('No past lunches yet') : t('The kitchen is open')}
          detail={
            past
              ? t('Shared lunches will stay here as a record.')
              : t('Host the first lunch, set your portion limit, and invite colleagues to join.')
          }
        />
      )}
      {(resource.data?.items ?? []).map((event) => (
        <ItemRow
          key={event.id}
          icon="calendar-outline"
          title={event.title ?? t('Office lunch')}
          detail={`${displayDate(event.meal_date)} · ${event.profiles?.display_name ?? t('Colleague')} · ${money(event.price_cents)} ${t('per portion')}`}
          summary={
            event.flags?.length || event.signup_deadline ? (
              <View style={{ gap: 6 }}>
                <MealFlagBadges flags={event.flags} />
                <SignupDeadlineBadge event={event} />
              </View>
            ) : undefined
          }
          label={t('View lunch & portions')}
          onPress={() => navigation.navigate('Event', { eventId: event.id })}
        />
      ))}
      {resource.data?.more && (
        <Button
          secondary
          title={t('More lunches')}
          busy={resource.loading || action.busy}
          onPress={() =>
            action.run(async () => {
              pages.current++;
              await resource.reload();
            })
          }
        />
      )}
    </Page>
  );
}
