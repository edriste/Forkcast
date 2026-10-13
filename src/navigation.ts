import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Place } from './lib/types';
export type MainTabParams = {
  Overview: undefined;
  Places: undefined;
  Cooking: undefined;
  Profile: undefined;
};
export type RootStackParams = {
  Tabs: NavigatorScreenParams<MainTabParams> | undefined;
  Search: { legacyPlaceId?: string; suggestForToday?: boolean } | undefined;
  Place: { placeId: string; initial?: Place };
  CreateEvent: undefined;
  Event: { eventId: string };
  CreateOrder: undefined;
  Orders: undefined;
  Order: { orderId: string };
};
