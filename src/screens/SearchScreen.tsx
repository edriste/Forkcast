import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { OSMAttribution } from '../components/maps/OSMAttribution';
import { PlaceDistance } from '../components/places/PlaceDistance';
import { Button, Card, Empty, Field, Notice, Page, useAction, useTheme } from '../components/ui';
import { placesRequest } from '../lib/places';
import { supabase } from '../lib/supabase';
import type { Place } from '../lib/types';
import type { RootStackParams } from '../navigation';
import { useAutomaticRefresh } from '../providers/LiveUpdates';
import { useLocale } from '../providers/Locale';
import { useOrganizations } from '../providers/Organizations';
export function SearchScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParams, 'Search'>) {
  const { t, date, placeCategory } = useLocale();

  const { styles } = useTheme();

  const org = useOrganizations().current!;
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searched, setSearched] = useState(false);
  const action = useAction();
  const [warning, setWarning] = useState('');
  const [refreshedAt, setRefreshedAt] = useState('');
  const [matching, setMatching] = useState<Place | null>(null);
  const legacyId = route.params?.legacyPlaceId;
  const submitted = useRef('');
  const focused = useIsFocused();
  const refreshSubmitted = () => {
    if (!submitted.current || matching) return;
    void action.run(async () => {
      const data = await placesRequest<{ places: Place[]; warning?: string; refreshedAt?: string }>(
        org.id,
        { action: 'search', query: submitted.current },
      );
      setPlaces(data.places);
      setWarning(data.warning ?? '');
      setRefreshedAt(data.refreshedAt ?? '');
    });
  };
  const latestRefresh = useRef(refreshSubmitted);
  latestRefresh.current = refreshSubmitted;
  useAutomaticRefresh(refreshSubmitted, ['places', 'organization'], focused);
  useFocusEffect(
    useCallback(() => {
      latestRefresh.current();
    }, []),
  );
  function search() {
    action.run(async () => {
      if (query.trim().length < 2) throw new Error('Enter at least two characters.');
      const data = await placesRequest<{ places: Place[]; warning?: string; refreshedAt?: string }>(
        org.id,
        {
          action: 'search',
          query,
        },
      );
      submitted.current = query;
      setPlaces(data.places);
      setWarning(data.warning ?? '');
      setRefreshedAt(data.refreshedAt ?? '');
      setMatching(null);
      setSearched(true);
    });
  }
  return (
    <Page>
      <Text style={styles.title}>{t('Find a lunch spot')}</Text>
      <Text style={styles.subtitle}>
        {t('Search lunch spots within 3 km of')} {org.search_area}
        {t(
          '. Names, cuisine and details come from OpenStreetMap, with cuisine corrections supplied by your team.',
        )}
      </Text>
      <Field
        label={t('Restaurant or cuisine')}
        value={query}
        onChangeText={setQuery}
        maxLength={160}
        returnKeyType="search"
        onSubmitEditing={search}
      />
      <Button title={t('Search lunch spots')} busy={action.busy} onPress={search} />
      <Notice error={action.error || warning} />
      {refreshedAt && (
        <Text style={styles.subtitle}>
          {t('Area information updated')} {date(refreshedAt)}.
        </Text>
      )}
      {legacyId && (
        <Text style={styles.subtitle}>
          {t(
            "Choose the restaurant that matches your previous entry. Only this group's reviews will be moved.",
          )}
        </Text>
      )}
      {matching && (
        <Card>
          <Text style={styles.heading}>
            {t('Match to')} {matching.name}?
          </Text>
          <Text style={styles.subtitle}>
            {t(
              'Keep all review authors, dates, ratings and comments. Reviews already attached to this OSM entry will be combined with them.',
            )}
          </Text>
          <Button
            title={t('Confirm match & keep reviews')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                const { error } = await supabase.rpc('link_legacy_place', {
                  org: org.id,
                  legacy_id: legacyId,
                  osm_place_id: matching.id,
                });
                if (error) throw error;
                navigation.reset({
                  index: 1,
                  routes: [
                    { name: 'Tabs' },
                    { name: 'Place', params: { placeId: matching.id, initial: matching } },
                  ],
                });
              })
            }
          />
          <Button
            secondary
            title={t('Choose another restaurant')}
            onPress={() => setMatching(null)}
          />
        </Card>
      )}
      {searched && !places.length && (
        <Empty title={t('No spots found')} detail={t('Try a different name or cuisine.')} />
      )}
      {places.map((place) => (
        <Card key={place.id}>
          <Text style={styles.heading}>{place.name}</Text>
          <Text style={styles.subtitle}>
            {placeCategory(place)} · {place.address}
          </Text>
          <PlaceDistance place={place} />
          {route.params?.suggestForToday && (
            <Button
              secondary
              title={t('Suggest {name} for today', { name: place.name })}
              busy={action.busy}
              onPress={() =>
                action.run(async () => {
                  const { error } = await supabase.rpc('suggest_lunch_place', {
                    org: org.id,
                    osm_place_id: place.id,
                  });
                  if (error) throw error;
                  navigation.navigate('Tabs', { screen: 'Overview' });
                })
              }
            />
          )}
          <Button
            secondary
            title={legacyId ? t('Match this place') : t('View place & review')}
            onPress={() =>
              legacyId
                ? setMatching(place)
                : navigation.navigate('Place', { placeId: place.id, initial: place })
            }
          />
        </Card>
      ))}
      {places.length > 0 && <OSMAttribution places={places} />}
    </Page>
  );
}
