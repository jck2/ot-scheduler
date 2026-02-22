import type { AppConfig, DayOfWeek } from '@/types';

export const DEFAULT_CONFIG: AppConfig = {
  activeDays: ['Monday', 'Tuesday', 'Thursday'] as DayOfWeek[],
  startTime: 510, // 8:30am
  endTime: 990, // 4:30pm — hard end
  preferredEndTime: 930, // 3:30pm — soft end, penalty beyond here
  slotDuration: 30,
  lunchStart: 780, // 1:00pm
  lunchEnd: 840, // 2:00pm
  providerName: 'Amanda Huang',
};

export const ALL_DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const SKIP_CELLS = [
  'lunch', 'prep', 'dismissal', 'not at compass', 'break',
  'planning', 'meeting', 'recess', 'arrival', 'duty',
];

export const PENALTY = {
  LUNCH_SLOT: 200,
  LATE_SLOT_PER_30MIN: 5,
  EXTENDED_HOURS_PER_SLOT: 50, // per 30-min slot past preferredEndTime
  PAST_HARD_END: 1000, // past endTime — essentially forbidden
  SAME_DAY_DOUBLE: 30,
} as const;
