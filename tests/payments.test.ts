import { expect, test } from 'vitest';
import { parsePrice, paypalHandle, paypalLink } from '../src/lib/payments';
import { inviteCode } from '../src/lib/invites';
test('prices use exact cents and reject ambiguous amounts', () => {
  expect(parsePrice('4.50')).toBe(450);
  expect(parsePrice('0,29')).toBe(29);
  expect(parsePrice('4.5')).toBe(450);
  expect(parsePrice('0')).toBe(0);
  for (const value of ['-1', '1.001', '1e3', '', 'Infinity', '100000.01'])
    expect(() => parsePrice(value)).toThrow();
});
test('PayPal links prefill the recipient, exact total and EUR', () => {
  expect(paypalLink('https://paypal.me/LunchCook/', 3, 429)).toBe(
    'https://paypal.me/LunchCook/12.87EUR',
  );
  expect(paypalLink('LunchCook', 3, 29)).toBe('https://paypal.me/LunchCook/0.87EUR');
  expect(paypalHandle('https://www.paypal.me/LunchCook')).toBe('LunchCook');
  for (const value of [
    'https://evil.test/cook',
    'cook/10',
    'cook?x=1',
    '',
    'name_with_dash',
    'https://paypal.me@evil.test/cook',
  ])
    expect(() => paypalHandle(value)).toThrow();
  expect(() => paypalLink('Cook', 0, 100)).toThrow();
  expect(() => paypalLink('Cook', 1, 0)).toThrow();
});
test('invite links only accept the Forkcast join route', () => {
  const code = '1234567890abcdef1234567890abcdef';
  expect(inviteCode(`forkcast://join?code=${code}`)).toBe(code);
  expect(inviteCode(code.toUpperCase())).toBe(code);
  expect(inviteCode(`https://evil.test?code=${code}`)).toBe('');
});
