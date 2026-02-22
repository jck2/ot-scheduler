export interface Student {
  firstName: string;
  lastName: string;
  grade: number;
  className: string;
  osisNumber: string;
  mandateRaw: string;
  mandateSessions: MandateSession[];
  provider: string;
}

export interface MandateSession {
  frequency: number; // sessions per week
  duration: number; // minutes
  groupSize: number; // 1=individual, 2=pair, 3=trio, etc.
  groupFlexible: boolean; // "group" keyword = flexible size (cap at 3)
}

export interface ScheduledSession {
  id: string;
  day: DayOfWeek;
  startTime: number; // minutes from midnight (e.g., 510 = 8:30)
  endTime: number;
  studentIds: string[]; // OSIS numbers
  mandateIndices: Record<string, number>; // studentId → which mandate this fulfills
  type: 'individual' | 'pair' | 'group';
  locked: boolean;
}

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export interface ProviderSchedule {
  providerName: string;
  sheetName: string;
  sessions: ExternalSession[];
}

export interface ExternalSession {
  day: DayOfWeek;
  startTime: number;
  endTime: number;
  studentNames: string[];
  rawText: string;
}

export interface Conflict {
  studentId: string;
  studentName: string;
  day: DayOfWeek;
  startTime: number;
  endTime: number;
  otherProvider: string;
  description: string;
}

export interface InitialMapping {
  initial: string;
  studentId: string;
  confidence: 'exact' | 'suggested' | 'ambiguous' | 'unknown';
  candidates?: { studentId: string; name: string; className: string }[];
  sourceSheet?: string; // which provider sheet this initial was found in
  context?: string; // co-scheduled students for disambiguation
}

export interface TimeSlot {
  startTime: number;
  endTime: number;
  day: DayOfWeek;
}

export interface AppConfig {
  activeDays: DayOfWeek[];
  startTime: number; // minutes from midnight
  endTime: number; // hard end — grid stops here
  preferredEndTime: number; // soft end — slots after this get a penalty
  slotDuration: number;
  lunchStart: number;
  lunchEnd: number;
  providerName: string;
  termStartDate?: string;
  termEndDate?: string;
}

export interface ValidationError {
  type: 'unmet_mandate' | 'double_booking' | 'cross_provider_conflict' | 'group_size' | 'wrong_class_mix' | 'time_overflow';
  severity: 'error' | 'warning';
  studentId?: string;
  sessionId?: string;
  message: string;
}

export type AppStep = 'upload' | 'provider-select' | 'disambiguation' | 'mode-select' | 'schedule' | 'export';
