import { supabase } from './supabase';
import type { CookingEvent, Participant } from './types';
import { localDate } from './format';
export { localDate, displayDate, money } from './format';
export async function events(org: string, past: boolean, page = 0): Promise<CookingEvent[]> {
  let query = supabase
    .from('cooking_events')
    .select('*,profiles!organizer_id(id,display_name)')
    .eq('organization_id', org);
  query = past ? query.lt('meal_date', localDate()) : query.gte('meal_date', localDate());
  const { data, error } = await query
    .order('meal_date', { ascending: !past })
    .order('id')
    .range(page * 30, page * 30 + 29);
  if (error) throw error;
  return data as unknown as CookingEvent[];
}
export async function eventDetail(org: string, id: string) {
  const { data: event, error } = await supabase
    .from('cooking_events')
    .select('*,profiles!organizer_id(id,display_name)')
    .eq('organization_id', org)
    .eq('id', id)
    .single();
  if (error) throw new Error('This event is unavailable or you no longer have access.');
  const participants: Participant[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('cooking_event_participants')
      .select('*,profiles!user_id(id,display_name)')
      .eq('event_id', id)
      .order('user_id')
      .range(offset, offset + 499);
    if (error) throw error;
    participants.push(...(data as unknown as Participant[]));
    if (data.length < 500) break;
  }
  return { event: event as unknown as CookingEvent, participants };
}
