import { useCallback } from 'react';
import { Image, Text } from 'react-native';
import { eventImages, uploadEventImage } from '../../lib/images';
import { useResource } from '../../lib/useResource';
import { useLocale } from '../../providers/Locale';
import { Button, Card, Notice, useAction, useTheme } from '../ui';

export function EventImages({
  eventId,
  userId,
  organizer,
}: {
  eventId: string;
  userId: string;
  organizer: boolean;
}) {
  const { t } = useLocale();
  const { styles } = useTheme();

  const action = useAction();
  const resource = useResource(
    useCallback(() => eventImages(eventId), [eventId]),
    ['images'],
  );
  return (
    <Card>
      <Text style={styles.heading}>{t('Meal photos & receipts')}</Text>
      <Text style={styles.subtitle}>{t('Shared privately with your lunch circle.')}</Text>
      <Notice error={action.error || resource.error} />
      {resource.loading && !resource.data && (
        <Text style={styles.subtitle}>{t('Loading images…')}</Text>
      )}
      {(resource.error || resource.data?.some((image) => !image.url)) && (
        <Button secondary title={t('Retry images')} onPress={resource.reload} />
      )}
      {resource.data?.length === 0 && (
        <Text style={styles.subtitle}>{t('No images uploaded yet.')}</Text>
      )}
      {resource.data?.map((image) => (
        <Card key={image.id}>
          <Text style={styles.label}>
            {image.kind === 'receipt' ? t('Grocery receipt') : t('Meal photo')}
          </Text>
          {image.url ? (
            <Image
              source={{ uri: image.url }}
              accessibilityLabel={
                image.kind === 'receipt'
                  ? t('Grocery receipt for this lunch')
                  : t('Photo of this lunch')
              }
              resizeMode="contain"
              style={{
                width: '100%',
                height: image.kind === 'receipt' ? 380 : 230,
                borderRadius: 12,
              }}
            />
          ) : (
            <Notice error={t('Image unavailable. Retrying automatically.')} />
          )}
        </Card>
      ))}
      {organizer && (
        <>
          {(
            [
              ['meal', 'Add meal photo'],
              ['receipt', 'Add grocery receipt'],
            ] as const
          ).map(([kind, label]) => (
            <Button
              key={kind}
              secondary
              title={t(label)}
              busy={action.busy}
              onPress={() =>
                action.run(async () => {
                  await uploadEventImage(eventId, userId, kind);
                  await resource.reload();
                })
              }
            />
          ))}
        </>
      )}
    </Card>
  );
}
