import { supabase } from './supabase';
export type CookingComment = {
  id: string;
  event_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  profiles: { id: string; display_name: string } | null;
};
// Fetch the visible window in bounded batches; live refresh also reflects edits and deletions.
export async function cookingComments(event: string, pages: number) {
  const comments: CookingComment[] = [];
  for (let page = 0; page < pages; page++) {
    const { data, error } = await supabase
      .from('cooking_comments')
      .select('*,profiles!author_id(id,display_name)')
      .eq('event_id', event)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * 20, page * 20 + 20);
    if (error) throw error;
    comments.push(...(data.slice(0, 20) as CookingComment[]));
    if (data.length <= 20) return { comments: comments.reverse(), more: false };
  }
  return { comments: comments.reverse(), more: true };
}
