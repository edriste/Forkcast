export type PushLink = { org: string; event?: string; order?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePushLink(search: string): PushLink | null {
  const query = new URLSearchParams(search);
  const org = query.get('pushOrg'),
    event = query.get('pushEvent'),
    order = query.get('pushOrder');
  if (
    !org ||
    !uuid.test(org) ||
    (event && !uuid.test(event)) ||
    (order && !uuid.test(order)) ||
    (event && order)
  )
    return null;
  return { org, ...(event ? { event } : {}), ...(order ? { order } : {}) };
}
