export function parsePrice(value: string): number {
  const clean = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean))
    throw new Error('Enter a price with at most two decimal places, e.g. 4.50.');
  const [whole, fraction = ''] = clean.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 10000000)
    throw new Error('The price must be between €0 and €100,000.');
  return cents;
}
export function paypalHandle(value: string): string {
  const input = value.trim();
  const handle = input.replace(/^https:\/\/(?:www\.)?paypal\.me\//i, '').replace(/\/$/, '');
  if (!/^[a-z0-9]{1,20}$/i.test(handle))
    throw new Error('Enter your PayPal.me username or full https://paypal.me/username link.');
  return handle;
}
export function paypalLink(handle: string, portions: number, priceCents: number): string {
  if (
    !Number.isInteger(portions) ||
    portions < 1 ||
    portions > 10000 ||
    !Number.isInteger(priceCents) ||
    priceCents <= 0 ||
    priceCents > 10000000
  )
    throw new Error('Invalid payment amount.');
  const total = portions * priceCents;
  return `https://paypal.me/${paypalHandle(handle)}/${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}EUR`;
}
