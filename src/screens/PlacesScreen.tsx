import { PlaceDistance } from '../components/PlaceDistance';
import { hasCoordinates } from '../lib/distance';
import { usePlaceFilters } from '../providers/PlaceFilters';
import { useFavorites } from '../providers/Favorites';
import { FavoriteButton } from '../components/FavoriteButton';
import { FavoritePlaces } from '../components/FavoritePlaces';
import { useLocale } from '../providers/Locale';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { useOrganizations } from '../providers/Organizations';
import {
  categories,
  filterReviewed,
  sortReviewed,
  reviewedPlaces,
  type Reviewed,
} from '../lib/reviews';
import { useResource } from '../lib/useResource';
import { Button, Empty, Notice, Page, useTheme } from '../components/ui';
import { PlaceFilters } from '../components/PlaceFilters';
import { ReviewedMap } from '../components/ReviewedMap';
import { IconAction, ItemRow } from '../components/compact';
import { OSMAttribution } from '../components/OSMAttribution';

export function PlacesScreen() {
  const { t, placeCategory, number } = useLocale();
  const { colors, styles } = useTheme();
  const org = useOrganizations().current!;
  const favorites = useFavorites();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const resource = useResource(
    useCallback(() => reviewedPlaces(org.id), [org.id]),
    ['places', 'organization'],
  );
  const [view, setView] = useState<'map' | 'list' | 'favorites'>('map');
  const {
    category,
    setCategory,
    minimum,
    setMinimum,
    maximumDistance,
    setMaximumDistance,
    sort,
    setSort,
  } = usePlaceFilters();
  const all = useMemo(() => resource.data?.places ?? [], [resource.data]);
  const filtered = useMemo(
    () => sortReviewed(filterReviewed(all, category, minimum, org, maximumDistance), sort, org),
    [all, category, minimum, maximumDistance, sort, org.latitude, org.longitude],
  );
  const pins = useMemo(
    () =>
      filtered.filter(
        ({ place }) => typeof place.latitude === 'number' && typeof place.longitude === 'number',
      ),
    [filtered],
  );
  const office = useMemo(
    () =>
      typeof org.latitude === 'number' && typeof org.longitude === 'number'
        ? { name: org.name, latitude: org.latitude, longitude: org.longitude }
        : undefined,
    [org.name, org.latitude, org.longitude],
  );
  function select(item: Reviewed) {
    navigation.navigate('Place', { placeId: item.place.id, initial: item.place });
  }
  return (
    <Page>
      <Notice
        error={
          view === 'favorites' ? '' : resource.error || resource.data?.warning || favorites.error
        }
      />
      {view !== 'favorites' &&
        (resource.error || resource.data?.failed.length || resource.data?.warning) && (
          <Button
            secondary
            title={t('Retry places')}
            onPress={resource.reload}
            busy={resource.loading}
          />
        )}
      {view !== 'favorites' && resource.data?.failed.length ? (
        <Notice
          error={t('{0} places could not be loaded. Retrying automatically.', {
            0: resource.data.failed.length,
          })}
        />
      ) : null}
      {view !== 'favorites' && favorites.error && (
        <Button
          secondary
          title={t('Retry favorites')}
          onPress={favorites.reload}
          busy={favorites.loading}
        />
      )}
      {view !== 'favorites' && (
        <PlaceFilters
          categories={categories(all)}
          {...{
            category,
            setCategory,
            minimum,
            setMinimum,
            maximumDistance,
            setMaximumDistance,
            sort,
            setSort,
          }}
          distanceAvailable={hasCoordinates(org)}
        />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('Place view')}
          style={{ flex: 1, flexDirection: 'row', gap: 8 }}
        >
          {(
            [
              { value: 'map', label: 'Map view' },
              { value: 'list', label: 'List view' },
              { value: 'favorites', label: 'Favorites view' },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={t(option.label)}
              accessibilityState={{ checked: view === option.value }}
              aria-checked={view === option.value}
              onPress={() => setView(option.value)}
              {...(Platform.OS === 'web'
                ? {
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === ' ' || event.key === 'Spacebar') {
                        event.preventDefault();
                        setView(option.value);
                      }
                    },
                  }
                : {})}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: view === option.value ? colors.orange : colors.line,
                backgroundColor: view === option.value ? colors.light : colors.surface,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text
                style={{
                  color: view === option.value ? colors.accent : colors.ink,
                  fontWeight: '700',
                }}
              >
                {t(option.value === 'map' ? 'Map' : option.value === 'list' ? 'List' : 'Favorites')}
              </Text>
            </Pressable>
          ))}
        </View>
        <IconAction
          title={t('Find a place & add a review')}
          icon="add-outline"
          onPress={() => navigation.navigate('Search')}
        />
      </View>
      {view !== 'favorites' && resource.loading && !resource.data && (
        <Text style={styles.subtitle}>{t('Loading reviewed places…')}</Text>
      )}
      {view === 'favorites' ? (
        <FavoritePlaces
          onOpen={(place) => navigation.navigate('Place', { placeId: place.id, initial: place })}
        />
      ) : view === 'map' ? (
        <>
          {(pins.length > 0 || office) && (
            <ReviewedMap places={pins} office={office} onSelect={select} />
          )}
          {resource.data && (
            <Text style={styles.subtitle}>
              {t(
                pins.length === 1
                  ? '1 reviewed spot on the map'
                  : '{count} reviewed spots on the map',
                { count: pins.length },
              )}
            </Text>
          )}
          {!pins.length &&
            !resource.loading &&
            !resource.error &&
            !resource.data?.failed.length && (
              <Empty
                title={
                  filtered.length
                    ? t('These places need a map location')
                    : all.length
                      ? t('No matching spots')
                      : t('Put your first spot on the map')
                }
                detail={
                  filtered.length
                    ? t(
                        'Switch to the list view to read reviews and match previous entries to OpenStreetMap.',
                      )
                    : all.length
                      ? t('Adjust the filters to see more places.')
                      : t('Search a restaurant and share your first review.')
                }
              />
            )}
          {filtered.length > pins.length && pins.length > 0 && (
            <Text style={styles.subtitle}>
              {t('Places without a map location are available in the list view.')}
            </Text>
          )}
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>
            {t(
              sort === 'nearest' && hasCoordinates(org)
                ? 'Your team’s tried-and-tasted spots. Sorted by straight-line distance from your office.'
                : 'Your team’s tried-and-tasted spots. Sorted by average rating.',
            )}
          </Text>
          {!filtered.length &&
            !resource.loading &&
            !resource.error &&
            !resource.data?.failed.length && (
              <Empty
                title={all.length ? t('No spots match') : t('Your next favorite starts here')}
                detail={
                  all.length
                    ? t('Try a different cuisine, rating or distance.')
                    : t('Search for a lunch spot and leave the first review for your team.')
                }
              />
            )}
          {filtered.map((item) => (
            <ItemRow
              key={item.place.id}
              title={item.place.name}
              detail={`${placeCategory(item.place)} · ${item.place.address}`}
              label={t('Read reviews')}
              summary={<PlaceDistance place={item.place} />}
              onPress={() => select(item)}
            >
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={styles.heading}>★ {number(Number(item.aggregate.average))}</Text>
                <Text style={styles.text}>
                  {item.aggregate.count} {t(item.aggregate.count === 1 ? 'review' : 'reviews')}
                </Text>
                {item.place.provider === 'osm' && (
                  <FavoriteButton id={item.place.id} name={item.place.name} />
                )}
              </View>
            </ItemRow>
          ))}
          {filtered.some(({ place }) => place.provider === 'osm') && <OSMAttribution />}
        </>
      )}
    </Page>
  );
}
