import { supabase } from './supabase';
import type { CookingEvent, Place } from './types';
import {
  applyCuisineOverride,
  type CuisineOverride,
} from '../../supabase/functions/_shared/cuisines';
export type LunchChoice = 'going_out' | 'brought_food' | 'no_lunch' | 'ordering_in';
export type LunchOption = { place: Place; votes: number; nominated?: boolean };
export type LunchOverview = {
  day: string;
  mine: LunchChoice | null;
  myVote: string | null;
  joinedCooking?: boolean;
  pickedPlaceId: string | null;
  counts: Record<LunchChoice | 'unanswered', number>;
  options: LunchOption[];
};
export async function lunchOverview(org: string): Promise<LunchOverview> {
  const { data, error } = await supabase.rpc('lunch_overview', { org });
  if (error) throw error;
  return {
    ...data,
    options: data.options.map((option: LunchOption & { override: CuisineOverride | null }) => ({
      place: applyCuisineOverride(option.place, option.override ?? undefined),
      votes: option.votes,
      nominated: option.nominated ?? false,
    })),
  };
}
export async function cookingToday(org: string, day: string) {
  const meals: CookingEvent[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase
      .from('cooking_events')
      .select('*,profiles!organizer_id(id,display_name)')
      .eq('organization_id', org)
      .eq('meal_date', day)
      .order('id')
      .range(offset, offset + 99);
    if (error) throw error;
    meals.push(...(data as unknown as CookingEvent[]));
    if (data.length < 100) return meals;
  }
}
export { restaurantLeaders } from './lunchPlan';
