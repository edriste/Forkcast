import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { lunchOverview } from '../../lib/lunch';
import { details } from '../../lib/places';
import { supabase } from '../../lib/supabase';
import type { Place } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import { useFavorites } from '../../providers/Favorites';
import { useLocale } from '../../providers/Locale';
import { useOrganizations } from '../../providers/Organizations';
import { OSMAttribution } from '../maps/OSMAttribution';
import { Button, Empty, Field, IconAction, ItemRow, Notice, useAction, useTheme } from '../ui';
import { FavoriteButton } from './FavoriteButton';
import { PlaceDistance } from './PlaceDistance';

export function FavoritePlaces({
  onOpen,
  onNominated,
}: {
  onOpen: (place: Place) => void;
  onNominated?: () => Promise<void>;
}) {
  const favorites = useFavorites();
  const org = useOrganizations().current!.id;
  const key = favorites.ids.join('|');
  const { t, placeCategory } = useLocale();
  const { styles } = useTheme();
  const [search, setSearch] = useState('');
  const action = useAction();
  const places = useResource(
    useCallback(
      () =>
        key
          ? details(org, key.split('|'))
          : Promise.resolve({ places: [] as Place[], failed: [] as string[], warning: '' }),
      [org, key],
    ),
    ['places', 'inbox', 'organization'],
  );
  const lunch = useResource(
    useCallback(() => lunchOverview(org), [org]),
    ['lunch', 'organization'],
  );
  const nominated = new Set(lunch.data?.options.map((option) => option.place.id) ?? []);
  const ids = new Set(favorites.ids);
  const items = (places.data?.places ?? [])
    .filter((place) => ids.has(place.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((place) =>
      (place.name + ' ' + place.address + ' ' + placeCategory(place))
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
    );
  const error =
    favorites.error || places.error || places.data?.warning || lunch.error || action.error;
  const loading = favorites.loading || places.loading;
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.subtitle}>
        {t('Your bookmarks for this organization. Nominate one for today’s lunch.')}
      </Text>
      <Notice error={error} />
      {(favorites.error || places.error || places.data?.failed.length || lunch.error) && (
        <Button
          secondary
          title={t('Retry favorites')}
          busy={loading}
          onPress={() =>
            action.run(async () => {
              await favorites.reload();
              await places.reload();
              await lunch.reload();
            })
          }
        />
      )}
      {(favorites.ids.length > 5 || !!search) && (
        <Field label={t('Search favorites')} value={search} onChangeText={setSearch} />
      )}
      {loading && <Text style={styles.subtitle}>{t('Loading favorites…')}</Text>}
      {!loading && !error && !favorites.ids.length && (
        <Empty
          title={t('No favorites yet')}
          detail={t('Use the bookmark button on a restaurant to save it here.')}
        />
      )}
      {!loading &&
        favorites.ids.length > 0 &&
        !items.length &&
        !error &&
        !places.data?.failed.length && (
          <Text style={styles.subtitle}>{t('No favorites match your search.')}</Text>
        )}
      {!!places.data?.failed.length && (
        <Text style={styles.subtitle}>
          {t('Some favorites could not be loaded. Please retry.')}
        </Text>
      )}
      {items.map((place) => (
        <ItemRow
          key={place.id}
          inset
          title={place.name}
          detail={`${placeCategory(place)} · ${place.address}`}
          label={t('View {name}', { name: place.name })}
          onPress={() => onOpen(place)}
          summary={
            <View style={{ gap: 4 }}>
              <PlaceDistance place={place} />
              {nominated.has(place.id) && (
                <Text style={styles.subtitle}>{t('Already on today’s shortlist')}</Text>
              )}
            </View>
          }
        >
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <FavoriteButton id={place.id} name={place.name} />
            <IconAction
              title={t(
                nominated.has(place.id)
                  ? '{name} is already nominated for today'
                  : 'Nominate {name} for today',
                { name: place.name },
              )}
              icon={nominated.has(place.id) ? 'checkmark-outline' : 'add-outline'}
              disabled={action.busy || lunch.loading || !!lunch.error || nominated.has(place.id)}
              onPress={() =>
                action.run(async () => {
                  const result = await supabase.rpc('suggest_lunch_place', {
                    org,
                    osm_place_id: place.id,
                  });
                  if (result.error) throw result.error;
                  await lunch.reload();
                  await onNominated?.();
                })
              }
            />
          </View>
        </ItemRow>
      ))}
      {items.length > 0 && <OSMAttribution places={items} />}
    </View>
  );
}
