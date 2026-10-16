import { expect, test, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/supabase', () => ({ supabase: { functions: { invoke } } }));
import { placesRequest } from '../src/lib/places';
const generic = 'Edge Function returned a non-2xx status code';
function failure(status: number, body: unknown) {
  invoke.mockResolvedValueOnce({
    data: null,
    error: { message: generic, context: new Response(JSON.stringify(body), { status }) },
  });
}
test('gateway failures explain unavailable restaurant service rather than exposing the SDK error', async () => {
  for (const status of [404, 500, 502, 503, 504]) {
    failure(status, { message: 'name resolution failed' });
    await expect(placesRequest('org', { action: 'details' })).rejects.toThrow(
      'Restaurant service is unavailable. Please try again shortly.',
    );
  }
  invoke.mockResolvedValueOnce({
    data: null,
    error: { message: 'Failed to send a request to the Edge Function' },
  });
  await expect(placesRequest('org', {})).rejects.toThrow('Restaurant service is unavailable.');
});
test('places errors retain validation and membership details and decode gateway message bodies', async () => {
  for (const payload of [
    { error: 'Organization access denied' },
    { message: 'Organization access denied' },
    { msg: 'Organization access denied' },
  ]) {
    failure(403, payload);
    await expect(placesRequest('org', {})).rejects.toThrow('Organization access denied');
  }
  failure(502, { error: 'OpenStreetMap lookup is busy. Please try again later.' });
  await expect(placesRequest('org', {})).rejects.toThrow('OpenStreetMap lookup is busy.');
  failure(401, { message: 'Invalid JWT' });
  await expect(placesRequest('org', {})).rejects.toThrow('Sign in first');
  invoke.mockResolvedValueOnce({ data: { places: [] }, error: null });
  await expect(placesRequest('org', { action: 'search', query: 'Soup' })).resolves.toEqual({
    places: [],
  });
  expect(invoke).toHaveBeenLastCalledWith('places', {
    body: { organizationId: 'org', action: 'search', query: 'Soup' },
  });
});
