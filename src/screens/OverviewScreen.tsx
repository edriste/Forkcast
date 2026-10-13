import { MealFlagBadges } from '../components/MealFlags';
import { useFavorites } from '../providers/Favorites';
import { FavoritePlaces } from '../components/FavoritePlaces';
import { SignupDeadlineBadge } from '../components/SignupDeadline';
import { useReducedMotion } from '../lib/useReducedMotion';
import { LunchDialog } from '../components/LunchDialog';
import { OrdersToday } from '../components/OrdersToday';
import { PlaceDistance } from '../components/PlaceDistance';
import { formatDistance, hasCoordinates } from '../lib/distance';
import { usePlaceFilters } from '../providers/PlaceFilters';
import { categoryName, filterReviewed, reviewedPlaces } from '../lib/reviews';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { useLocale } from '../providers/Locale';
import { useOrganizations } from '../providers/Organizations';
import { supabase } from '../lib/supabase';
import { localDate } from '../lib/format';
import { cookingToday, lunchOverview, restaurantLeaders, type LunchChoice } from '../lib/lunch';
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
import { Ionicons } from '@expo/vector-icons';
import { IconAction, SectionHeading, ItemRow, InfoDisclosure } from '../components/compact';
import { LunchWheel } from '../components/LunchWheel';
import { OSMAttribution } from '../components/OSMAttribution';
const choices: {
  value: LunchChoice;
  label: string;
  short: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { value: 'going_out', label: "I'm going out", short: 'Going out', icon: 'restaurant-outline' },
  {
    value: 'brought_food',
    label: "I'm eating in the office",
    short: 'Eating in the office',
    icon: 'business-outline',
  },
  {
    value: 'no_lunch',
    label: 'No lunch / not in the office',
    short: 'No lunch / away',
    icon: 'remove-circle-outline',
  },
  {
    value: 'ordering_in',
    label: "I'm ordering food to the office",
    short: 'Ordering in',
    icon: 'bicycle-outline',
  },
];
function PlanAction({
  label,
  title,
  icon,
  disabled = false,
  grow = false,
  selected,
  onPress,
}: {
  label: string;
  title?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  grow?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors, styles } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title ?? label}
      accessibilityState={{ disabled, selected }}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: grow ? 1 : undefined,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: selected ? colors.light : colors.field,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={colors.accent} accessible={false} />
      <Text style={[styles.text, { color: colors.accent, flexShrink: 1 }]}>{label}</Text>
    </Pressable>
  );
}
export function OverviewScreen() {
  const { t, displayDate, money, number, placeCategory, locale } = useLocale();
  const { styles, colors } = useTheme();
  const org = useOrganizations().current!;
  const favorites = useFavorites();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const today = localDate();
  const [spinning, setSpinning] = useState(false);
  const [celebration, setCelebration] = useState(0);
  const [lastSpinName, setLastSpinName] = useState('');
  const reducedMotion = useReducedMotion();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestSource, setSuggestSource] = useState<'saved' | 'favorites'>('saved');
  const [listOpen, setListOpen] = useState(false);
  const [savedSearch, setSavedSearch] = useState('');
  const [voteSearch, setVoteSearch] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const { width, height } = useWindowDimensions();
  const filters = usePlaceFilters();
  const action = useAction();
  const overview = useResource(
    useCallback(() => lunchOverview(org.id), [org.id]),
    ['lunch', 'places', 'organization'],
  );
  const day = overview.data?.day ?? today;
  const cooking = useResource(
    useCallback(() => cookingToday(org.id, day), [org.id, day]),
    ['cooking', 'organization'],
  );
  const lifetime = React.useRef(true);
  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, []);
  const data = overview.data;
  const hasNominations = !!data?.options.some((option) => option.nominated);
  const eligible = useResource(
    useCallback(
      async () =>
        (suggestOpen && suggestSource === 'saved') || (pickerOpen && !hasNominations)
          ? reviewedPlaces(org.id)
          : null,
      [org.id, pickerOpen, suggestOpen, suggestSource, hasNominations],
    ),
    ['places', 'organization'],
  );

  if (overview.loading && !data) return <Loading />;
  const options = data?.options ?? [];
  const nominations = options.filter((option) => option.nominated);
  const fallback = filterReviewed(
    eligible.data?.places ?? [],
    filters.category,
    filters.minimum,
    org,
    filters.maximumDistance,
  ).filter((item) => item.place.provider === 'osm');
  const candidatePlaces = nominations.length
    ? nominations.map((option) => option.place)
    : fallback.map((item) => item.place);
  const candidates = candidatePlaces.map((place) => place.id);
  const poolLoading = !nominations.length && eligible.loading;
  const matchingCandidates = candidatePlaces.filter((place) =>
    (place.name + ' ' + place.address + ' ' + placeCategory(place))
      .toLocaleLowerCase()
      .includes(candidateSearch.trim().toLocaleLowerCase()),
  );
  const leaders = restaurantLeaders(options);
  const picked = options.find((option) => option.place.id === data?.pickedPlaceId);
  const planned = picked ?? (leaders.length === 1 ? leaders[0] : undefined);
  const canVote = data?.mine === 'going_out';
  const busy = action.busy || spinning;
  const orderedOptions = [...options].sort(
    (a, b) =>
      Number(b.place.id === planned?.place.id) - Number(a.place.id === planned?.place.id) ||
      b.votes - a.votes,
  );
  const savedPlaces = (eligible.data?.places ?? []).filter(
    (item) =>
      item.place.provider === 'osm' &&
      (item.place.name + ' ' + item.place.address + ' ' + placeCategory(item.place))
        .toLocaleLowerCase()
        .includes(savedSearch.trim().toLocaleLowerCase()),
  );
  function renderOption(option: (typeof options)[number]) {
    return (
      <ItemRow
        key={option.place.id}
        inset
        title={option.place.name}
        detail={
          option.place.id === planned?.place.id
            ? picked
              ? t('Picked by the wheel for your team.')
              : t('Leading the vote. The plan can change as colleagues vote.')
            : placeCategory(option.place)
        }
        label={t('Read reviews for {name}', { name: option.place.name })}
        summary={<PlaceDistance place={option.place} />}
        onPress={() => {
          setListOpen(false);
          navigation.navigate('Place', {
            placeId: option.place.id,
            initial: option.place,
          });
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            data?.myVote === option.place.id
              ? t('Remove my vote for {name}', { name: option.place.name })
              : t('Vote for {name}', { name: option.place.name })
          }
          accessibilityState={{
            disabled: !canVote || busy,
            selected: data?.myVote === option.place.id,
          }}
          disabled={!canVote || busy}
          onPress={() =>
            action.run(() =>
              mutate('vote_lunch_place', {
                osm_place_id: data?.myVote === option.place.id ? null : option.place.id,
              }),
            )
          }
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 10,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: data?.myVote === option.place.id ? colors.orange : colors.field,
            opacity: !canVote || busy ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name={data?.myVote === option.place.id ? 'checkmark' : 'thumbs-up-outline'}
            size={18}
            color={data?.myVote === option.place.id ? colors.onOrange : colors.accent}
            accessible={false}
          />
          <Text
            style={[
              styles.text,
              { color: data?.myVote === option.place.id ? colors.onOrange : colors.ink },
            ]}
          >
            {t(option.votes === 1 ? '1 vote' : '{count} votes', {
              count: option.votes,
            })}
          </Text>
        </Pressable>
      </ItemRow>
    );
  }
  async function mutate(name: string, values: Record<string, unknown>) {
    const { error } = await supabase.rpc(name, { org: org.id, ...values });
    if (error) throw error;
    await overview.reload();
  }
  return (
    <Page>
      <View style={{ gap: 4 }}>
        <Text style={[styles.title, { textAlign: 'center' }]}>{t("What's for lunch today?")}</Text>
        <Text style={[styles.subtitle, { textAlign: 'center' }]}>{displayDate(day)}</Text>
      </View>
      <Notice error={overview.error || action.error} />
      {overview.error && (
        <Button secondary title={t('Retry')} onPress={overview.reload} busy={overview.loading} />
      )}
      {data && (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {t('Your lunch today')}
                </Text>
                {data.counts.unanswered > 0 && (
                  <Text style={styles.subtitle}>
                    {t('{count} unanswered', { count: data.counts.unanswered })}
                  </Text>
                )}
              </View>
              {data.mine && (
                <IconAction
                  title={t('Clear my answer')}
                  icon="close-outline"
                  busy={busy}
                  onPress={() => action.run(() => mutate('set_lunch_response', { answer: null }))}
                />
              )}
            </View>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('Your lunch today')}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
            >
              {choices.map((choice) => (
                <Pressable
                  key={choice.value}
                  accessibilityRole="radio"
                  accessibilityLabel={t(choice.label)}
                  accessibilityHint={t('{count} colleagues chose this.', {
                    count: data.counts[choice.value],
                  })}
                  aria-checked={data.mine === choice.value}
                  accessibilityState={{ checked: data.mine === choice.value, disabled: busy }}
                  aria-disabled={busy}
                  disabled={busy}
                  onPress={() =>
                    action.run(() => mutate('set_lunch_response', { answer: choice.value }))
                  }
                  {...(Platform.OS === 'web'
                    ? {
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if ((event.key === ' ' || event.key === 'Spacebar') && !busy) {
                            event.preventDefault();
                            event.stopPropagation();
                            void action.run(() =>
                              mutate('set_lunch_response', { answer: choice.value }),
                            );
                          }
                        },
                      }
                    : {})}
                  style={({ pressed }) => ({
                    flexGrow: 1,
                    flexBasis: '45%',
                    minHeight: 56,
                    paddingHorizontal: 10,
                    paddingVertical: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 16,
                    backgroundColor: data.mine === choice.value ? colors.light : colors.field,
                    borderWidth: 1,
                    borderColor: data.mine === choice.value ? colors.orange : colors.line,
                    opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                    transform: [{ scale: pressed && !busy ? 0.98 : 1 }],
                  })}
                >
                  <Ionicons
                    name={data.mine === choice.value ? 'checkmark-circle' : choice.icon}
                    size={20}
                    color={colors.accent}
                    accessible={false}
                  />
                  <Text style={[styles.text, { flex: 1 }]}>{t(choice.short)}</Text>
                  <Text style={[styles.heading, { fontSize: 20 }]}>
                    {data.counts[choice.value]}
                  </Text>
                </Pressable>
              ))}
            </View>
            {data.joinedCooking && data.mine === 'brought_food' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons
                  name="restaurant-outline"
                  size={16}
                  color={colors.accent}
                  accessible={false}
                />
                <Text style={styles.subtitle}>{t('Joined office cooking')}</Text>
              </View>
            )}
          </Card>
          <Card>
            <Text accessibilityRole="header" style={styles.heading}>
              {t("Today's plan")}
            </Text>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text
                  accessibilityRole="header"
                  style={[styles.badge, { flex: 1, color: colors.muted }]}
                >
                  {t('Office cooking').toUpperCase()}
                </Text>
                <PlanAction
                  label={t('Plan lunch')}
                  title={t('Host an office lunch')}
                  icon="add-outline"
                  onPress={() => navigation.navigate('CreateEvent')}
                />
              </View>
              <Notice error={cooking.error} />
              {cooking.error && (
                <Button
                  secondary
                  title={t('Retry cooking')}
                  onPress={cooking.reload}
                  busy={cooking.loading}
                />
              )}
              {cooking.loading && !cooking.data && (
                <Text style={styles.subtitle}>{t('Loading lunches…')}</Text>
              )}
              {cooking.data?.length === 0 && (
                <Text style={styles.subtitle}>{t('No office cooking planned today.')}</Text>
              )}
              {cooking.data?.map((meal) => (
                <ItemRow
                  key={meal.id}
                  inset
                  icon="restaurant-outline"
                  title={meal.title ?? t('Office lunch')}
                  detail={`${t('Hosted by')} ${meal.profiles?.display_name ?? t('Colleague')} · ${money(meal.price_cents)} ${t('per portion')}`}
                  summary={
                    meal.flags?.length || meal.signup_deadline ? (
                      <View style={{ gap: 6 }}>
                        <MealFlagBadges flags={meal.flags} />
                        <SignupDeadlineBadge event={meal} />
                      </View>
                    ) : undefined
                  }
                  label={t('View lunch & portions')}
                  onPress={() => navigation.navigate('Event', { eventId: meal.id })}
                />
              ))}
            </View>
            <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 16, gap: 12 }}>
              <OrdersToday day={data?.day ?? localDate()} />
              <Text accessibilityRole="header" style={[styles.badge, { color: colors.muted }]}>
                {t('Restaurants').toUpperCase()}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PlanAction
                  label={t('Spin the wheel')}
                  grow
                  icon="aperture-outline"
                  disabled={!canVote || busy}
                  onPress={() => {
                    setCelebration(0);
                    setLastSpinName('');
                    setCandidateSearch('');
                    setPickerOpen(true);
                  }}
                />
                <PlanAction
                  label={t('Suggest a place')}
                  grow
                  title={t('Suggest a restaurant for today')}
                  icon="add-outline"
                  onPress={() => {
                    setSavedSearch('');
                    setSuggestSource(favorites.ids.length ? 'favorites' : 'saved');
                    setSuggestOpen(true);
                  }}
                />
              </View>
              {!planned && options.length > 0 && (
                <Text style={styles.subtitle}>
                  {leaders.length > 1
                    ? t('The vote is tied. Spin the wheel to pick a restaurant.')
                    : t('Vote or let us pick a restaurant for today.')}
                </Text>
              )}
              <Modal
                visible={pickerOpen}
                transparent
                animationType={Platform.OS === 'web' ? 'none' : 'fade'}
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => {
                  if (!busy) setPickerOpen(false);
                }}
              >
                <View
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Close restaurant picker')}
                    disabled={busy}
                    onPress={() => setPickerOpen(false)}
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
                    accessibilityLabel={t('Spin the wheel')}
                    accessibilityViewIsModal
                    style={{
                      width: Math.min(420, width - 48),
                      maxHeight: height - 80,
                      backgroundColor: colors.surface,
                      borderRadius: 24,
                      padding: 20,
                      gap: 12,
                    }}
                  >
                    <SectionHeading title={t('Spin the wheel')}>
                      <IconAction
                        title={t('Close restaurant picker')}
                        icon="close-outline"
                        disabled={busy}
                        onPress={() => setPickerOpen(false)}
                      />
                    </SectionHeading>
                    <ScrollView contentContainerStyle={{ gap: 16 }} style={{ flexShrink: 1 }}>
                      <Text style={styles.subtitle}>
                        {nominations.length
                          ? t('Choosing from today’s nominations.')
                          : t('Choosing from reviewed places matching your Places filters.')}
                      </Text>
                      {!nominations.length && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={[styles.subtitle, { flex: 1 }]}>
                            {t('Cuisine')}:{' '}
                            {filters.category === 'All'
                              ? t('All cuisines')
                              : t(categoryName(filters.category))}
                            {'\n'}
                            {t('Rating')}:{' '}
                            {filters.minimum
                              ? t('{0}+ stars', {
                                  0: number(filters.minimum).replace(/[.,]0$/, ''),
                                })
                              : t('Any rating')}
                            {filters.maximumDistance > 0 &&
                              hasCoordinates(org) &&
                              `\n${t('Distance')}: ${t('Within {distance}', { distance: formatDistance(filters.maximumDistance, locale) })}`}
                          </Text>
                          <PlanAction
                            label={t('Adjust filters')}
                            icon="options-outline"
                            disabled={busy}
                            onPress={() => {
                              setPickerOpen(false);
                              navigation.navigate('Tabs', { screen: 'Places' });
                            }}
                          />
                        </View>
                      )}
                      {!poolLoading && (
                        <LunchWheel
                          spinning={spinning}
                          options={candidates.length}
                          celebration={celebration}
                        />
                      )}
                      {!!candidates.length && !poolLoading && (
                        <InfoDisclosure
                          title={t('View candidates · {count}', { count: candidates.length })}
                        >
                          {(candidatePlaces.length > 5 || !!candidateSearch) && (
                            <Field
                              label={t('Search candidates')}
                              value={candidateSearch}
                              onChangeText={setCandidateSearch}
                            />
                          )}
                          <ScrollView
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                            style={{ maxHeight: 220 }}
                            contentContainerStyle={{ gap: 8 }}
                          >
                            {matchingCandidates.map((place) => (
                              <View key={place.id} style={{ gap: 4, paddingVertical: 8 }}>
                                <Text style={styles.text}>{place.name}</Text>
                                <Text style={styles.subtitle}>{placeCategory(place)}</Text>
                                <PlaceDistance place={place} />
                              </View>
                            ))}
                            {!matchingCandidates.length && (
                              <Text style={styles.subtitle}>
                                {t('No candidates match your search.')}
                              </Text>
                            )}
                          </ScrollView>
                        </InfoDisclosure>
                      )}
                      <Notice
                        error={
                          action.error ||
                          (!nominations.length ? eligible.error || eligible.data?.warning : '')
                        }
                      />
                      {!nominations.length && eligible.error && (
                        <Button secondary title={t('Retry places')} onPress={eligible.reload} />
                      )}
                      {!nominations.length && eligible.loading && (
                        <Text style={styles.subtitle}>{t('Loading…')}</Text>
                      )}
                      {!poolLoading && !eligible.error && !candidates.length && (
                        <View style={{ gap: 8 }}>
                          <Text style={styles.subtitle}>
                            {t(
                              (eligible.data?.places ?? []).some(
                                (item) => item.place.provider === 'osm',
                              )
                                ? 'No restaurants match these filters.'
                                : 'No reviewed restaurants yet. Review a place or suggest a restaurant for today.',
                            )}
                          </Text>
                          {(filters.category !== 'All' ||
                            filters.minimum > 0 ||
                            filters.maximumDistance > 0) && (
                            <Button
                              secondary
                              title={t('Reset filters')}
                              disabled={busy}
                              onPress={() => {
                                filters.setCategory('All');
                                filters.setMinimum(0);
                                filters.setMaximumDistance(0);
                              }}
                            />
                          )}
                          <Button
                            secondary
                            title={t('Suggest a place')}
                            disabled={busy}
                            onPress={() => {
                              setPickerOpen(false);
                              setSavedSearch('');
                              setSuggestSource(favorites.ids.length ? 'favorites' : 'saved');
                              setSuggestOpen(true);
                            }}
                          />
                        </View>
                      )}
                      <Button
                        title={spinning ? t('Spinning…') : t('Spin the wheel')}
                        disabled={
                          !canVote ||
                          !candidates.length ||
                          busy ||
                          (!nominations.length && (eligible.loading || !!eligible.error))
                        }
                        onPress={() =>
                          action.run(async () => {
                            const started = Date.now();
                            setCelebration(0);
                            setLastSpinName('');
                            setSpinning(true);
                            try {
                              const { data: chosen, error } = await supabase.rpc(
                                'spin_lunch_wheel',
                                {
                                  org: org.id,
                                  candidate_ids: candidates,
                                },
                              );
                              if (error) throw error;
                              const remaining = reducedMotion
                                ? 0
                                : Math.max(0, 1600 - (Date.now() - started));
                              if (remaining)
                                await new Promise((resolve) => setTimeout(resolve, remaining));
                              if (lifetime.current) {
                                const winner =
                                  options.find((option) => option.place.id === chosen)?.place ??
                                  fallback.find((item) => item.place.id === chosen)?.place;
                                setLastSpinName(winner?.name ?? '');
                                setCelebration((value) => value + 1);
                                void overview.reload();
                              }
                            } finally {
                              if (lifetime.current) setSpinning(false);
                            }
                          })
                        }
                      />
                      {spinning && (
                        <Text accessibilityRole="alert" style={styles.subtitle}>
                          {t('Picking a restaurant…')}
                        </Text>
                      )}
                      {!spinning && (lastSpinName || picked) && (
                        <Text accessibilityRole="alert" style={styles.heading}>
                          {t('Wheel result: {name}', { name: lastSpinName || picked!.place.name })}
                        </Text>
                      )}
                      <Text style={styles.subtitle}>
                        {t(
                          'Each option has an equal chance. The result is saved for everyone; spinning again replaces it.',
                        )}
                      </Text>
                    </ScrollView>
                  </View>
                </View>
              </Modal>
              {!canVote && (
                <Text style={styles.subtitle}>
                  {t(
                    'Choose “I’m going out” to vote or spin. Changing your answer removes your restaurant vote.',
                  )}
                </Text>
              )}
              {!options.length && (
                <Empty
                  title={t('No restaurant options yet')}
                  detail={t(
                    'Suggest a saved place or discover somewhere new. You can also let us pick for you.',
                  )}
                />
              )}
              {orderedOptions.slice(0, 3).map(renderOption)}
              {options.length > 3 && (
                <Button
                  secondary
                  title={t('View all · {count}', { count: options.length })}
                  onPress={() => {
                    setVoteSearch('');
                    setListOpen(true);
                  }}
                />
              )}
            </View>
          </Card>
          <LunchDialog
            visible={suggestOpen}
            title={t('Suggest a restaurant for today')}
            busy={busy}
            onClose={() => setSuggestOpen(false)}
          >
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PlanAction
                grow
                label={t('Saved places')}
                selected={suggestSource === 'saved'}
                icon="restaurant-outline"
                onPress={() => setSuggestSource('saved')}
              />
              <PlanAction
                grow
                label={t('Favorites · {count}', { count: favorites.ids.length })}
                selected={suggestSource === 'favorites'}
                icon="bookmark-outline"
                onPress={() => setSuggestSource('favorites')}
              />
            </View>
            {suggestSource === 'favorites' && suggestOpen ? (
              <FavoritePlaces
                onOpen={(place) => {
                  setSuggestOpen(false);
                  navigation.navigate('Place', { placeId: place.id, initial: place });
                }}
                onNominated={async () => {
                  await overview.reload();
                  setSuggestOpen(false);
                }}
              />
            ) : (
              <>
                <Field
                  label={t('Search saved places')}
                  value={savedSearch}
                  onChangeText={setSavedSearch}
                />
                <PlanAction
                  label={t('Discover new places')}
                  icon="search-outline"
                  onPress={() => {
                    setSuggestOpen(false);
                    navigation.navigate('Search', { suggestForToday: true });
                  }}
                />
                <Notice error={eligible.error || eligible.data?.warning || action.error} />
                {eligible.error && (
                  <Button secondary title={t('Retry places')} onPress={eligible.reload} />
                )}
                {eligible.loading && <Text style={styles.subtitle}>{t('Loading…')}</Text>}
                {!eligible.loading && !savedPlaces.length && (
                  <Text style={styles.subtitle}>{t('No saved places match your search.')}</Text>
                )}
                {savedPlaces.map(({ place }) => (
                  <ItemRow
                    key={place.id}
                    inset
                    title={place.name}
                    detail={placeCategory(place)}
                    label={t('Suggest {name}', { name: place.name })}
                    onPress={() => {
                      if (!busy)
                        action.run(async () => {
                          await mutate('suggest_lunch_place', { osm_place_id: place.id });
                          setSuggestOpen(false);
                        });
                    }}
                    summary={
                      <Text style={styles.subtitle}>
                        {options.some((option) => option.place.id === place.id)
                          ? t('Already on today’s shortlist')
                          : t('Add to today’s shortlist')}
                      </Text>
                    }
                  />
                ))}
              </>
            )}
          </LunchDialog>
          <LunchDialog
            visible={listOpen}
            title={t('Today’s restaurant shortlist')}
            busy={busy}
            onClose={() => setListOpen(false)}
          >
            <Field
              label={t('Search today’s options')}
              value={voteSearch}
              onChangeText={setVoteSearch}
            />
            <Notice error={action.error} />
            {orderedOptions
              .filter((option) =>
                option.place.name
                  .toLocaleLowerCase()
                  .includes(voteSearch.trim().toLocaleLowerCase()),
              )
              .map(renderOption)}
            {orderedOptions.every(
              (option) =>
                !option.place.name
                  .toLocaleLowerCase()
                  .includes(voteSearch.trim().toLocaleLowerCase()),
            ) && <Text style={styles.subtitle}>{t('No restaurants match your search.')}</Text>}
          </LunchDialog>
          <InfoDisclosure title={t('How lunch planning works')}>
            <Text style={styles.subtitle}>
              {t('One answer per person. You can change it anytime today.')}
            </Text>
            <Text style={styles.subtitle}>
              {t('One vote per person. Choosing another restaurant moves your vote.')}
            </Text>
            <Text style={styles.subtitle}>
              {t(
                'Each option has an equal chance. The result is saved for everyone; spinning again replaces it.',
              )}
            </Text>
          </InfoDisclosure>
          {options.length > 0 && <OSMAttribution />}
        </>
      )}
    </Page>
  );
}
