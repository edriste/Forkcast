export type PushPreferences = {
  enabled: boolean;
  locale: 'en' | 'de';
  timezone: string;
  quiet_start: number;
  quiet_end: number;
  daily_limit: number;
  cooking: boolean;
  deadlines: boolean;
  arrivals: boolean;
  replies: boolean;
  payments: boolean;
  organizer: boolean;
};
export type PushSettings = { preferences: PushPreferences; endpoints: string[] };
