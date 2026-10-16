import type { Reviewed } from '../../lib/reviews';

export type ReviewedMapProps = {
  places: Reviewed[];
  onSelect?: (place: Reviewed) => void;
  office?: { name: string; latitude: number; longitude: number };
  onPick?: (latitude: number, longitude: number) => void;
};
