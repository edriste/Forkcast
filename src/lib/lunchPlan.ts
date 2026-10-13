import type { LunchOption } from './lunch';
export function restaurantLeaders(options: LunchOption[]) {
  const votes = Math.max(0, ...options.map((option) => option.votes));
  return votes > 0 ? options.filter((option) => option.votes === votes) : [];
}
