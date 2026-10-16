import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { supabase } from '../../lib/supabase';
import type { OfficeLocation, Organization } from '../../lib/types';
import { useLocale } from '../../providers/Locale';
import { useOrganizations } from '../../providers/Organizations';
import { Button, Notice, useAction, useTheme } from '../ui';
import { OfficeLocationPicker } from './OfficeLocationPicker';

function savedOfficeLocation(org: Organization): OfficeLocation | null {
  if (org.latitude == null || org.longitude == null) return null;
  return {
    label: org.location_label ?? org.search_area,
    latitude: org.latitude,
    longitude: org.longitude,
  };
}

export function SearchAreaSettings() {
  const { t } = useLocale();
  const { styles } = useTheme();

  const orgs = useOrganizations();
  const org = orgs.current!;
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState<OfficeLocation | null>(null);
  useEffect(() => {
    setEditing(false);
    setLocation(savedOfficeLocation(org));
  }, [org.id, org.latitude, org.longitude, org.location_label, org.search_area]);
  if (!editing)
    return (
      <Button
        secondary
        title={
          org.latitude == null ? t('Set organization location') : t('Change organization location')
        }
        onPress={() => setEditing(true)}
      />
    );
  return (
    <>
      <Text style={styles.subtitle}>
        {t('Changing the location reloads nearby places; existing reviews stay available.')}
      </Text>
      <OfficeLocationPicker value={location} onChange={setLocation} disabled={action.busy} />
      <Button
        title={t('Save organization location')}
        busy={action.busy}
        disabled={!location}
        onPress={() =>
          action.run(async () => {
            if (!location) throw new Error('Select an organization location.');
            const { error } = await supabase.rpc('set_organization_location', {
              org: org.id,
              area: location.label.slice(0, 120),
              office_latitude: location.latitude,
              office_longitude: location.longitude,
              office_label: location.label,
            });
            if (error) throw error;
            await orgs.reload(org.id);
            setEditing(false);
          })
        }
      />
      <Button
        secondary
        title={t('Cancel location change')}
        disabled={action.busy}
        onPress={() => {
          setLocation(savedOfficeLocation(org));
          setEditing(false);
        }}
      />
      <Notice error={action.error} />
    </>
  );
}
