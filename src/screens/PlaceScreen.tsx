import { PlaceDistance } from '../components/PlaceDistance';
import { useLocale } from '../providers/Locale';
import { useFavorites } from '../providers/Favorites';
import { FavoriteButton } from '../components/FavoriteButton';
import { SectionHeading } from '../components/compact';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParams } from '../navigation';
import { details } from '../lib/places';
import { supabase } from '../lib/supabase';
import { ownReview, placeReviews } from '../lib/reviews';
import type { Aggregate, Review } from '../lib/types';
import { useSession } from '../providers/Auth';
import { useOrganizations } from '../providers/Organizations';
import { useResource } from '../lib/useResource';
import {
  Button,
  Card,
  Chip,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  useAction,
  useTheme,
} from '../components/ui';
import { OSMAttribution } from '../components/OSMAttribution';
import { RatingSummary } from '../components/RatingSummary';
import { PlaceCuisineEditor } from '../components/PlaceCuisineEditor';

export function PlaceScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParams, 'Place'>) {
  const { t, date, placeCategory } = useLocale();

  const { styles } = useTheme();

  const org = useOrganizations().current!;
  const favorites = useFavorites();
  const action = useAction();
  const session = useSession();
  const id = route.params.placeId;
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = useRef(false);
  const reviewPages = useRef(1);
  const refreshSource = useRef(0);
  const load = useCallback(async () => {
    const refresh = Date.now() < refreshSource.current;
    const [result, reviews, ratings, mine] = await Promise.all([
      details(org.id, [id], refresh, true),
      (async () => {
        const reviews: Review[] = [];
        for (let page = 0; page < reviewPages.current; page++) {
          const items = await placeReviews(org.id, id, page);
          reviews.push(...items);
          if (items.length < 20) break;
        }
        return reviews;
      })(),
      supabase
        .from('place_ratings')
        .select('*')
        .eq('organization_id', org.id)
        .eq('place_id', id)
        .maybeSingle(),
      ownReview(org.id, id, session.user.id),
    ]);
    if (ratings.error) throw ratings.error;
    if (!result.places.length)
      throw new Error('Place details could not be loaded. Please try again.');
    return {
      place: result.places[0],
      reviews,
      mine,
      aggregate: ratings.data as Aggregate | null,
      warning: result.warning,
    };
  }, [org.id, id, session.user.id]);
  const resource = useResource(load, ['places', 'organization', 'inbox']);
  useEffect(() => {
    dirty.current = false;
    reviewPages.current = 1;
    setStars(0);
    setComment('');
    setSaved(false);
  }, [org.id, id]);
  useEffect(() => {
    if (!resource.data || dirty.current) return;
    setStars(resource.data.mine?.stars ?? 0);
    setComment(resource.data.mine?.comment ?? '');
  }, [resource.data]);
  const place = resource.data?.place ?? route.params.initial;
  if (resource.loading && !place) return <Loading />;
  return (
    <Page>
      <Notice error={resource.error || action.error || favorites.error || resource.data?.warning} />
      {(resource.error || resource.data?.warning) && (
        <Button secondary title={t('Retry details')} onPress={resource.reload} />
      )}
      {favorites.error && (
        <Button
          secondary
          title={t('Retry favorites')}
          onPress={favorites.reload}
          busy={favorites.loading}
        />
      )}
      {place && (
        <Card>
          <Text style={styles.badge}>{placeCategory(place).toUpperCase()}</Text>
          <SectionHeading large title={place.name}>
            {place.provider === 'osm' && <FavoriteButton id={place.id} name={place.name} />}
          </SectionHeading>
          <Text style={styles.subtitle}>{place.address}</Text>
          <PlaceDistance place={place} showUnavailable />
          {place.provider === 'osm' && !place.hours.length && (
            <Text style={styles.subtitle}>{t('Opening hours not listed.')}</Text>
          )}
          {place.updatedAt && (
            <Text style={styles.subtitle}>
              {t('OSM information updated')} {date(place.updatedAt)}.
            </Text>
          )}
          {place.hours.map((hour) => (
            <Text key={hour} style={styles.text}>
              {hour}
            </Text>
          ))}
          {place.website && (
            <Button
              secondary
              title={t('Visit website')}
              onPress={() =>
                action.run(async () => {
                  await Linking.openURL(place.website!);
                })
              }
            />
          )}
          {place.mapsUrl && (
            <Button
              secondary
              title={
                place.provider === 'osm'
                  ? t('Open in OpenStreetMap')
                  : t('Open original place reference')
              }
              onPress={() =>
                action.run(async () => {
                  await Linking.openURL(place.mapsUrl!);
                })
              }
            />
          )}
          {place.provider === 'osm' && <OSMAttribution />}
        </Card>
      )}
      {resource.data?.aggregate && (
        <Card>
          <Text style={styles.badge}>
            {org.name.toUpperCase()} {t('RATINGS')}
          </Text>
          <RatingSummary aggregate={resource.data.aggregate} />
          <Text style={styles.subtitle}>{t('Each colleague’s latest review counts once.')}</Text>
        </Card>
      )}
      {place?.provider === 'osm' && (
        <PlaceCuisineEditor
          key={`${org.id}:${place.id}`}
          place={place}
          org={org.id}
          onEditOSM={() => {
            refreshSource.current = Date.now() + 600000;
          }}
          onSaved={async (refresh) => {
            if (refresh) refreshSource.current = Date.now() + 600000;
            await resource.reload();
          }}
        />
      )}
      {place?.provider === 'google_legacy' && (
        <Card>
          <Text style={styles.heading}>{t('Keep this review history')}</Text>
          <Text style={styles.subtitle}>
            {t(
              'This entry needs to be matched to an OpenStreetMap restaurant. Its colleague reviews are preserved.',
            )}
          </Text>
          {org.role === 'admin' ? (
            <Button
              title={t('Match to an OSM place')}
              onPress={() => navigation.navigate('Search', { legacyPlaceId: id })}
            />
          ) : (
            <Text style={styles.subtitle}>{t('Ask an administrator to match this entry.')}</Text>
          )}
        </Card>
      )}
      {place?.provider === 'osm' && (
        <Card>
          <Text style={styles.heading}>
            {resource.data?.mine ? t('Edit your review') : t('How was lunch?')}
          </Text>
          <Text style={styles.label}>{t('Star rating')}</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Chip
                key={value}
                label={`${value} ★`}
                selected={stars === value}
                onPress={() => {
                  dirty.current = true;
                  setStars(value);
                  setSaved(false);
                }}
              />
            ))}
          </View>
          <Field
            label={t('Your thoughts (optional)')}
            multiline
            maxLength={2000}
            value={comment}
            onChangeText={(text) => {
              dirty.current = true;
              setSaved(false);
              setComment(text);
            }}
            placeholder={t('What should your colleagues know?')}
          />
          <Button
            title={resource.data?.mine ? t('Save changes') : t('Share review')}
            busy={action.busy}
            disabled={!resource.data || resource.loading}
            onPress={() =>
              action.run(async () => {
                if (!stars) throw new Error('Select a star rating.');
                const { error } = await supabase.rpc('save_review', {
                  org: org.id,
                  osm_place_id: id,
                  rating: stars,
                  review_comment: comment,
                });
                if (error) throw error;
                dirty.current = false;
                setSaved(true);
                await resource.reload();
              })
            }
          />
          {saved && (
            <Text style={styles.text}>{t('Your review is at the table. Thanks for sharing!')}</Text>
          )}
          <Notice error={action.error} />
        </Card>
      )}
      <Text style={styles.heading}>{t('Colleague reviews')}</Text>
      <Text style={styles.subtitle}>
        {t('Newest first · Private to')} {org.name}
      </Text>
      {resource.data && resource.data.reviews.length === 0 && (
        <Empty
          title={t('Be the first to share')}
          detail={t('Your experience helps the whole team decide.')}
        />
      )}
      {(resource.data?.reviews ?? []).map((review) => (
        <Card key={review.id}>
          <Text style={styles.heading}>{review.profiles?.display_name ?? t('Colleague')}</Text>
          <Text style={styles.subtitle}>
            {t('Updated')} {date(review.created_at)} · {'★'.repeat(review.stars)}
          </Text>
          {review.comment && <Text style={styles.text}>{review.comment}</Text>}
        </Card>
      ))}
      {resource.data?.reviews.length === reviewPages.current * 20 && (
        <Button
          secondary
          title={t('Older reviews')}
          busy={action.busy || resource.loading}
          onPress={() =>
            action.run(async () => {
              reviewPages.current++;
              await resource.reload();
            })
          }
        />
      )}
    </Page>
  );
}
