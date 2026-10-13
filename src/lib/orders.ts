import { supabase } from './supabase';
import { parsePrice, paypalHandle } from './payments';
import type { Profile } from './types';
export type OrderStatus = 'open' | 'closed' | 'placed' | 'arrived' | 'cancelled';
export type OfficeOrder = {
  id: string;
  organization_id: string;
  organizer_id: string;
  order_date: string;
  restaurant: string;
  menu_url: string;
  signup_deadline: string;
  delivery_address: string;
  delivery_notes: string;
  paypal_handle: string | null;
  status: OrderStatus;
  delivery_fee_cents: number;
  arrival_at: string | null;
  version: number;
  profiles: Profile | null;
};
export type OrderMember = {
  order_id: string;
  user_id: string;
  ready: boolean;
  revision: number;
  total_cents: number | null;
  paid: boolean;
  payment_confirmed_at: string | null;
  profiles: Profile | null;
};
export type OrderItem = {
  id: string;
  order_id: string;
  user_id: string;
  item_name: string;
  quantity: number;
  unit_cents: number;
  notes: string;
};
export type ItemDraft = { name: string; quantity: string; price: string; notes: string };
export const emptyItem = (): ItemDraft => ({ name: '', quantity: '1', price: '', notes: '' });
export function parseOrderItems(items: ItemDraft[]) {
  if (!items.length || items.length > 50) throw new Error('Add between 1 and 50 order items');
  return items.map((item) => {
    const unit_cents = parsePrice(item.price);
    if (
      !item.name.trim() ||
      item.name.trim().length > 120 ||
      !/^\d+$/.test(item.quantity) ||
      Number(item.quantity) < 1 ||
      Number(item.quantity) > 100 ||
      unit_cents > 100000 ||
      item.notes.length > 500
    )
      throw new Error('Check each item name, quantity (1–100) and price (up to €1,000).');
    return {
      item_name: item.name.trim(),
      quantity: Number(item.quantity),
      unit_cents,
      notes: item.notes.trim(),
    };
  });
}
export function menuUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter an http or https menu link.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Enter an http or https menu link.');
  return url.href;
}
export function orderPaymentLink(handle: string, cents: number) {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 501000000)
    throw new Error('Invalid payment amount.');
  return `https://paypal.me/${paypalHandle(handle)}/${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}EUR`;
}
export function groupOrderItems(
  items: OrderItem[],
  members: OrderMember[],
  colleague = 'Colleague',
) {
  const groups = new Map<
    string,
    { name: string; notes: string; price: number; quantity: number; people: string[] }
  >();
  for (const item of items) {
    const key = JSON.stringify([
      item.item_name.trim().toLocaleLowerCase(),
      item.unit_cents,
      item.notes,
    ]);
    const group = groups.get(key) ?? {
      name: item.item_name,
      notes: item.notes,
      price: item.unit_cents,
      quantity: 0,
      people: [],
    };
    group.quantity += item.quantity;
    group.people.push(
      `${members.find((m) => m.user_id === item.user_id)?.profiles?.display_name ?? colleague} ×${item.quantity}`,
    );
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.notes.localeCompare(b.notes),
  );
}
export async function officeOrders(
  org: string,
  day?: string,
  past?: boolean,
  page = 0,
): Promise<OfficeOrder[]> {
  let query = supabase
    .from('office_orders')
    .select('*,profiles!organizer_id(id,display_name)')
    .eq('organization_id', org);
  if (day)
    query =
      past === undefined
        ? query.eq('order_date', day)
        : past
          ? query.lt('order_date', day)
          : query.gte('order_date', day);
  const { data, error } = await query
    .order('order_date', { ascending: !past })
    .order('created_at', { ascending: false })
    .range(page * 30, page * 30 + 29);
  if (error) throw error;
  return data as unknown as OfficeOrder[];
}
export async function officeOrderDetail(org: string, id: string) {
  const { data, error } = await supabase
    .from('office_orders')
    .select('*,profiles!organizer_id(id,display_name)')
    .eq('organization_id', org)
    .eq('id', id)
    .single();
  if (error) throw new Error('This order is unavailable or you no longer have access.');
  const members: OrderMember[] = [];
  const items: OrderItem[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase
      .from('office_order_members')
      .select('*,profiles!user_id(id,display_name)')
      .eq('order_id', id)
      .order('user_id')
      .range(offset, offset + 499);
    if (result.error) throw result.error;
    members.push(...(result.data as unknown as OrderMember[]));
    if (result.data.length < 500) break;
  }
  for (let offset = 0; ; offset += 500) {
    const result = await supabase
      .from('office_order_items')
      .select('*')
      .eq('order_id', id)
      .order('id')
      .range(offset, offset + 499);
    if (result.error) throw result.error;
    items.push(...(result.data as OrderItem[]));
    if (result.data.length < 500) break;
  }
  return { order: data as unknown as OfficeOrder, members, items };
}
export function orderStatusLabel(order: OfficeOrder, now = Date.now()) {
  if (order.status === 'open' && Date.parse(order.signup_deadline) <= now) return 'Signup closed';
  return {
    open: 'Choosing',
    closed: 'Order locked',
    placed: 'Order placed',
    arrived: 'Food has arrived',
    cancelled: 'Order cancelled',
  }[order.status];
}
