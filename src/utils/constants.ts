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

/**
 * Time bands where the provider can only see certain classes. Each band tints its
 * grid rows and flags any scheduled student whose class is unavailable then. A
 * session belongs to a band when its startTime is in [start, end). Single source
 * of truth for both the highlight (WeeklyGrid/TimeSlotCell) and the validator.
 */
export interface TimeBand {
  start: number; // minutes from midnight (inclusive)
  end: number; // minutes from midnight (exclusive)
  label: string;
  bgClass: string; // cell highlight, like the lunch band
  restrictedClasses: string[]; // lowercased class names unavailable in this band
}

export const RESTRICTED_TIME_BANDS: TimeBand[] = [
  {
    start: 600, // 10:00am
    end: 660, // 11:00am
    label: '10–11',
    bgClass: 'bg-blue-300',
    restrictedClasses: ['pine', 'honeylocust'],
  },
  {
    start: 660, // 11:00am
    end: 720, // 12:00pm
    label: '11–12',
    bgClass: 'bg-purple-300',
    restrictedClasses: ['elm', 'magnolia'],
  },
];

export function bandForStartTime(startTime: number): TimeBand | undefined {
  return RESTRICTED_TIME_BANDS.find((b) => startTime >= b.start && startTime < b.end);
}

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
