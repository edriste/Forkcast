import { CookingParticipants } from '../components/CookingParticipants';
import { MealFlagsEditor } from '../components/MealFlags';
import { SignupDeadlineEditor } from '../components/SignupDeadline';
import { signupClosed } from '../lib/signupDeadline';
import { useSignupClock } from '../lib/useSignupClock';
import { useNotifications } from '../providers/Notifications';
import { useLocale } from '../providers/Locale';
import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { useOrganizations } from '../providers/Organizations';
import { useSession } from '../providers/Auth';
import { eventDetail, localDate } from '../lib/cooking';
import { supabase } from '../lib/supabase';
import { useResource } from '../lib/useResource';
import {
  Button,
  Card,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  useAction,
  useTheme,
} from '../components/ui';
import { SectionHeading } from '../components/compact';
import { EventImages } from '../components/EventImages';
import { EventPayment } from '../components/EventPayment';
export function EventScreen({ route }: NativeStackScreenProps<RootStackParams, 'Event'>) {
  const { t, money, displayDate } = useLocale();

  const { styles } = useTheme();

  const org = useOrganizations().current!;
  const session = useSession();
  const action = useAction();
  const notifications = useNotifications();
  const [quantity, setQuantity] = useState('1');
  const dirtyQuantity = React.useRef(false);
  const [leaving, setLeaving] = useState(false);
  const resource = useResource(
    useCallback(() => eventDetail(org.id, route.params.eventId), [org.id, route.params.eventId]),
    ['cooking', 'organization'],
  );
  const mine = resource.data?.participants.find(
    (participant) => participant.user_id === session.user.id,
  );
  const now = useSignupClock([resource.data?.event.signup_deadline]);
  const registrationClosed = resource.data ? signupClosed(resource.data.event, now) : false;
  useEffect(() => {
    if (!dirtyQuantity.current) setQuantity(String(mine?.portions ?? 1));
  }, [mine?.portions]);
  if (resource.loading && !resource.data) return <Loading />;
  const data = resource.data;
  async function reserve(portions: number) {
    const { error } = await supabase.rpc('set_portions', {
      event: route.params.eventId,
      quantity: portions,
    });
    if (error) {
      await resource.reload();
      throw error;
    }
    await notifications.refresh();
    dirtyQuantity.current = false;
    setQuantity(String(portions || 1));
    setLeaving(false);
    await resource.reload();
  }
  return (
    <Page>
      <Notice error={resource.error || action.error} />
      {resource.error && (
        <Button
          secondary
          title={t('Retry lunch')}
          onPress={resource.reload}
          busy={resource.loading}
        />
      )}
      {data && (
        <>
          <Card>
            <Text style={styles.badge}>{displayDate(data.event.meal_date).toUpperCase()}</Text>
            <SectionHeading large title={data.event.title ?? t('Office lunch')} />
            <Text style={styles.subtitle}>
              {t('Hosted by')} {data.event.profiles?.display_name ?? t('Colleague')}
            </Text>
            {data.event.description && <Text style={styles.text}>{data.event.description}</Text>}
            <MealFlagsEditor
              event={data.event}
              organizer={data.event.organizer_id === session.user.id}
              onSaved={resource.reload}
            />
            <Text style={styles.heading}>
              {money(data.event.price_cents)} {t('per portion')}
            </Text>
            <Text style={styles.text}>
              {data.participants.reduce((sum, participant) => sum + participant.portions, 0)}{' '}
              {t('portions requested')}
            </Text>
            <Text style={styles.text}>
              {data.event.max_portions === null
                ? t('Unlimited portions — everyone’s welcome')
                : t('{0} of {1} portions remaining', {
                    0:
                      data.event.max_portions -
                      data.participants.reduce((sum, participant) => sum + participant.portions, 0),
                    1: data.event.max_portions,
                  })}
            </Text>
            <SignupDeadlineEditor
              event={data.event}
              organizer={data.event.organizer_id === session.user.id}
              onSaved={resource.reload}
            />
          </Card>
          {data.event.meal_date >= localDate(new Date(now)) && (!registrationClosed || mine) ? (
            <Card>
              <Text style={styles.heading}>
                {mine ? t('Your place at the table') : t('Join the lunch')}
              </Text>
              {registrationClosed && (
                <Text style={styles.subtitle}>
                  {t(
                    'Signup is closed. You can reduce portions or leave; payment remains available.',
                  )}
                </Text>
              )}
              <Field
                label={t('Your portions')}
                keyboardType="number-pad"
                value={quantity}
                onChangeText={(value) => {
                  dirtyQuantity.current = true;
                  setQuantity(value);
                }}
              />
              <Text style={styles.subtitle}>
                {t('Amount due:')}{' '}
                {/^\d+$/.test(quantity) && Number(quantity) <= 10000
                  ? money(Number(quantity) * data.event.price_cents)
                  : t('Choose a quantity')}
              </Text>
              <Button
                title={mine ? t('Update portions') : t('Save my portions')}
                busy={action.busy}
                disabled={registrationClosed && Number(quantity) > (mine?.portions ?? 0)}
                onPress={() =>
                  action.run(async () => {
                    if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 10000)
                      throw new Error('Choose between 1 and 10000 portions.');
                    await reserve(Number(quantity));
                  })
                }
              />
              {mine && (
                <Button
                  secondary
                  title={leaving ? t('Confirm: leave this lunch') : t('Leave lunch')}
                  busy={action.busy}
                  onPress={() => {
                    if (!leaving) setLeaving(true);
                    else action.run(() => reserve(0));
                  }}
                />
              )}
              {leaving && (
                <Button secondary title={t('Keep my portions')} onPress={() => setLeaving(false)} />
              )}
              <Notice error={action.error} />
            </Card>
          ) : (
            <Empty
              title={t(
                data.event.meal_date < localDate(new Date(now))
                  ? 'This lunch has passed'
                  : 'Signup closed',
              )}
              detail={t(
                data.event.meal_date < localDate(new Date(now))
                  ? 'Portion signups are closed. You can still see participants and documentation.'
                  : 'The signup deadline has passed. No new reservations can be made.',
              )}
            />
          )}
          {mine && <EventPayment event={data.event} participant={mine} refresh={resource.reload} />}
          <CookingParticipants
            event={data.event}
            participants={data.participants}
            userId={session.user.id}
          />
          <EventImages
            eventId={data.event.id}
            userId={session.user.id}
            organizer={data.event.organizer_id === session.user.id}
          />
        </>
      )}
    </Page>
  );
}
