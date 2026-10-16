import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { parsePushLink } from '../../lib/pushLink';
import type { RootStackParams } from '../../navigation';
import { useOrganizations } from '../../providers/Organizations';

export function usePushNavigation(
  navigation: NavigationContainerRefWithCurrent<RootStackParams>,
  ready: number,
) {
  const orgs = useOrganizations();
  const [target, setTarget] = useState(() =>
    Platform.OS === 'web' ? parsePushLink(window.location.search) : null,
  );
  useEffect(() => {
    if (!target || orgs.loading) return;
    const clear = () => {
      setTarget(null);
      if (Platform.OS === 'web') {
        const url = new URL(window.location.href);
        ['pushOrg', 'pushEvent', 'pushOrder'].forEach((key) => url.searchParams.delete(key));
        window.history.replaceState(window.history.state, '', url.toString());
      }
    };
    if (!orgs.organizations.some((org) => org.id === target.org)) {
      clear();
      return;
    }
    if (orgs.current?.id !== target.org) {
      orgs.select(target.org);
      return;
    }
    if (!navigation.isReady()) return;
    if (target.order) navigation.navigate('Order', { orderId: target.order });
    else if (target.event) navigation.navigate('Event', { eventId: target.event });
    else navigation.navigate('Tabs', { screen: 'Overview' });
    clear();
  }, [target, orgs.loading, orgs.current?.id, orgs.organizations, ready, navigation]);
}
