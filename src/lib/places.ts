import { supabase } from './supabase';
import type { Place } from './types';
export async function placesRequest<T>(
  organizationId: string | undefined,
  body: object,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('places', {
    body: { ...body, organizationId },
  });
  if (error) {
    let detail = error.message;
    if ('context' in error && error.context instanceof Response) {
      try {
        detail = (await error.context.json()).error ?? detail;
      } catch {
        /* keep original error */
      }
    }
    throw new Error(detail);
  }
  if (data.error) throw new Error(data.error);
  return data;
}
export async function details(
  organizationId: string,
  ids: string[],
  refresh = false,
  automatic = false,
) {
  const places: Place[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const result = await placesRequest<{ places: Place[]; failed: string[]; warning?: string }>(
      organizationId,
      {
        action: 'details',
        ids: ids.slice(i, i + 100),
        ...(refresh ? { refresh: true, ...(automatic ? { automatic: true } : {}) } : {}),
      },
    );
    places.push(...result.places);
    failed.push(...result.failed);
    if (result.warning) warnings.push(result.warning);
  }
  return { places, failed, warning: [...new Set(warnings)].join('\n') };
}
