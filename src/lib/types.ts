import type { MealFlag } from './mealFlags';
export type { OfficeLocation } from '../../supabase/functions/_shared/location';
export type Organization = {
  id: string;
  name: string;
  search_area: string;
  created_by: string;
  latitude: number | null;
  longitude: number | null;
  location_label: string | null;
};
export type Profile = { id: string; display_name: string };
export type Review = {
  id: string;
  organization_id: string;
  place_id: string;
  author_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  profiles: Profile | null;
};
export type { Place } from '../../supabase/functions/_shared/osm';
import type { Place } from '../../supabase/functions/_shared/osm';
export type Aggregate = {
  place_id: string;
  average: number;
  count: number;
};
export type ReviewedPlace = { place: Place; aggregate: Aggregate };
export type CookingEvent = {
  flags?: MealFlag[];
  signup_deadline?: string | null;
  id: string;
  organization_id: string;
  organizer_id: string;
  meal_date: string;
  title: string | null;
  description: string | null;
  max_portions: number | null;
  price_cents: number;
  currency: 'EUR';
  paypal_handle: string | null;
  profiles: Profile | null;
};
export type Participant = {
  event_id: string;
  user_id: string;
  portions: number;
  paid: boolean;
  profiles: Profile | null;
};
export type EventImage = {
  id: string;
  event_id: string;
  storage_path: string;
  kind: 'receipt' | 'meal';
  url?: string;
};
