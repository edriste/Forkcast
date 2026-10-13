import { expect, test, vi } from 'vitest';
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
import {
  groupOrderItems,
  menuUrl,
  orderPaymentLink,
  parseOrderItems,
  type OrderItem,
  type OrderMember,
} from '../src/lib/orders';
test('order item input uses exact cents, preserves requests and rejects invalid quantities and unsafe menu URLs', () => {
  expect(
    parseOrderItems([{ name: ' Pizza ', quantity: '2', price: '8,50', notes: ' no onions ' }]),
  ).toEqual([{ item_name: 'Pizza', quantity: 2, unit_cents: 850, notes: 'no onions' }]);
  for (const quantity of ['0', '1.5', '101'])
    expect(() => parseOrderItems([{ name: 'Pizza', quantity, price: '8', notes: '' }])).toThrow();
  expect(() => menuUrl('javascript:alert(1)')).toThrow();
  expect(() => menuUrl('https://user:password@example.invalid')).toThrow();
  expect(menuUrl('https://example.invalid/menu')).toBe('https://example.invalid/menu');
  expect(orderPaymentLink('Alice', 1850)).toBe('https://paypal.me/Alice/18.50EUR');
});
test('checkout groups identical choices but separates different special requests and prices', () => {
  const members = [
    { user_id: 'a', profiles: { display_name: 'Alice' } },
    { user_id: 'b', profiles: { display_name: 'Bob' } },
  ] as OrderMember[];
  const items = [
    { user_id: 'a', item_name: 'Pizza', quantity: 2, unit_cents: 850, notes: '' },
    { user_id: 'b', item_name: 'Pizza', quantity: 1, unit_cents: 850, notes: '' },
    { user_id: 'b', item_name: 'Pizza', quantity: 1, unit_cents: 850, notes: 'no cheese' },
  ] as OrderItem[];
  const grouped = groupOrderItems(items, members);
  expect(grouped).toHaveLength(2);
  expect(grouped[0].quantity).toBe(3);
  expect(grouped[0].people).toEqual(['Alice ×2', 'Bob ×1']);
  expect(grouped[1].notes).toBe('no cheese');
});
