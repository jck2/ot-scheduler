import type { Conflict, DayOfWeek, ScheduledSession, Student, AppConfig } from '@/types';
import { PENALTY } from '@/utils/constants';
import { slotsOverlap } from '@/utils/timeUtils';

export interface ConstraintResult {
  satisfied: boolean;
  penalty: number;
  reason?: string;
}

// Hard constraints: must be satisfied

export function checkProviderSlotFree(
  day: DayOfWeek,
  startTime: number,
  endTime: number,
  existingSessions: ScheduledSession[]
): ConstraintResult {
  for (const s of existingSessions) {
    if (s.day !== day) continue;
    if (slotsOverlap(startTime, endTime, s.startTime, s.endTime)) {
      return { satisfied: false, penalty: Infinity, reason: `Provider already has a session at ${startTime}` };
    }
  }
  return { satisfied: true, penalty: 0 };
}

export function checkNoDoubleBooking(
  studentId: string,
  day: DayOfWeek,
  startTime: number,
  endTime: number,
  existingSessions: ScheduledSession[]
): ConstraintResult {
  for (const s of existingSessions) {
    if (s.day !== day) continue;
    if (!s.studentIds.includes(studentId)) continue;
    if (slotsOverlap(startTime, endTime, s.startTime, s.endTime)) {
      return { satisfied: false, penalty: Infinity, reason: `Student double-booked at ${startTime}` };
    }
  }
  return { satisfied: true, penalty: 0 };
}

export function checkNoCrossProviderConflict(
  studentId: string,
  day: DayOfWeek,
  startTime: number,
  endTime: number,
  conflicts: Conflict[]
): ConstraintResult {
  for (const c of conflicts) {
    if (c.studentId !== studentId) continue;
    if (c.day !== day) continue;
    if (slotsOverlap(startTime, endTime, c.startTime, c.endTime)) {
      return {
        satisfied: false,
        penalty: Infinity,
        reason: `Conflicts with ${c.otherProvider}`,
      };
    }
  }
  return { satisfied: true, penalty: 0 };
}

export function checkSameClassGroup(
  studentIds: string[],
  studentMap: Map<string, Student>
): ConstraintResult {
  if (studentIds.length <= 1) return { satisfied: true, penalty: 0 };

  const classes = new Set<string>();
  for (const id of studentIds) {
    const s = studentMap.get(id);
    if (s) classes.add(s.className);
  }

  if (classes.size > 1) {
    return {
      satisfied: false,
      penalty: Infinity,
      reason: `Group mixes classes: ${Array.from(classes).join(', ')}`,
    };
  }
  return { satisfied: true, penalty: 0 };
}

export function checkActiveDay(day: DayOfWeek, config: AppConfig): ConstraintResult {
  if (!config.activeDays.includes(day)) {
    return { satisfied: false, penalty: Infinity, reason: `${day} is not an active day` };
  }
  return { satisfied: true, penalty: 0 };
}

export function checkWednesdayEnd(
  day: DayOfWeek,
  endTime: number
): ConstraintResult {
  if (day === 'Wednesday' && endTime > 810) { // 1:30pm
    return { satisfied: false, penalty: Infinity, reason: 'Wednesday must end by 1:30pm' };
  }
  return { satisfied: true, penalty: 0 };
}

// Soft constraints: prefer but allow

export function scoreLunchPenalty(
  startTime: number,
  endTime: number,
  config: AppConfig
): number {
  if (slotsOverlap(startTime, endTime, config.lunchStart, config.lunchEnd)) {
    return PENALTY.LUNCH_SLOT;
  }
  return 0;
}

export function scoreTimePenalty(startTime: number, config: AppConfig): number {
  // Small penalty scaling with how late the slot is
  const slotsFromStart = Math.floor((startTime - config.startTime) / 30);
  return slotsFromStart * PENALTY.LATE_SLOT_PER_30MIN;
}

export function scoreExtendedHours(_startTime: number, endTime: number, config: AppConfig): number {
  if (endTime <= config.preferredEndTime) return 0;
  // Graduated penalty: each 30-min slot past preferred end costs more
  const slotsOver = Math.ceil((endTime - config.preferredEndTime) / 30);
  let penalty = slotsOver * PENALTY.EXTENDED_HOURS_PER_SLOT;
  // Hard end — very expensive
  if (endTime > config.endTime) penalty += PENALTY.PAST_HARD_END;
  return penalty;
}

export function scoreSameDayDouble(
  studentId: string,
  day: DayOfWeek,
  existingSessions: ScheduledSession[]
): number {
  const sameDayCount = existingSessions.filter(
    (s) => s.day === day && s.studentIds.includes(studentId)
  ).length;
  return sameDayCount > 0 ? PENALTY.SAME_DAY_DOUBLE : 0;
}

