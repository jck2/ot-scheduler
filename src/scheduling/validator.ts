import type { AppConfig, Conflict, DayOfWeek, ScheduledSession, Student, ValidationError } from '@/types';
import { minutesToTime, slotsOverlap } from '@/utils/timeUtils';

/** Largest group size any of a student's mandates permits (0 = individual only). */
export function studentMaxGroupSize(student: Student): number {
  let max = 0;
  for (const m of student.mandateSessions) {
    if (m.groupFlexible) max = Math.max(max, 3);
    else if (m.groupSize > 1) max = Math.max(max, Math.min(m.groupSize, 3));
  }
  return max;
}

// --- Slot grouping (shared by the calendar cards and the roster chip) ---
// "Grouped" is inferred from co-location: a student's session is a group session
// if another student is scheduled in the SAME slot (same day + start time), no
// matter whether they live in one session object or several. This is the single
// source of truth so the calendar and the roster indicator always agree.

export function slotKey(day: DayOfWeek, startTime: number): string {
  return `${day}|${startTime}`;
}

/** Map of slot → the distinct students scheduled there (this provider only). */
export function buildSlotOccupancy(sessions: ScheduledSession[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of sessions) {
    const key = slotKey(s.day, s.startTime);
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    for (const id of s.studentIds) set.add(id);
  }
  return map;
}

export function slotStudentCount(
  day: DayOfWeek,
  startTime: number,
  occupancy: Map<string, Set<string>>
): number {
  return occupancy.get(slotKey(day, startTime))?.size ?? 0;
}

export function validateSchedule(
  sessions: ScheduledSession[],
  students: Student[],
  conflicts: Conflict[],
  config: AppConfig
): ValidationError[] {
  const errors: ValidationError[] = [];
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));

  // --- Per-student totals (consistent with the roster chip) ---
  // Sessions count toward a student regardless of individual/group. Grouping is
  // inferred from co-location, so "grouped" here means sharing a slot.
  for (const student of students) {
    const summary = getStudentSessionSummary(student, sessions);
    const name = `${student.firstName} ${student.lastName}`.trim();

    if (summary.totalScheduled < summary.totalRequired) {
      errors.push({
        type: 'unmet_mandate',
        severity: 'error',
        studentId: student.osisNumber,
        message: `${name}: ${summary.totalScheduled} of ${summary.totalRequired} sessions/week scheduled.`,
      });
    } else if (summary.totalScheduled > summary.totalRequired) {
      errors.push({
        type: 'unmet_mandate',
        severity: 'warning',
        studentId: student.osisNumber,
        message: `${name}: ${summary.totalScheduled} sessions scheduled, but the mandate is only ${summary.totalRequired}/week.`,
      });
    }

    // Too many grouped sessions vs the cap (mirrors the red "Group" chip).
    if (summary.maxGroupSessions > 0 && summary.groupedScheduled > summary.maxGroupSessions) {
      errors.push({
        type: 'group_size',
        severity: 'error',
        studentId: student.osisNumber,
        message: `${student.firstName} is in ${summary.groupedScheduled} group session(s), but the mandate allows at most ${summary.maxGroupSessions}.`,
      });
    }
  }

  // --- Per-slot group validity (co-location = intended group) ---
  // Amanda's baseline assumption: two students in one calendar block are a group.
  // The validator explains why a given grouping is invalid, rather than silently
  // re-modeling it as separate individual sessions.
  const occupancy = buildSlotOccupancy(sessions);
  for (const [key, idSet] of occupancy) {
    if (idSet.size <= 1) continue;
    const [dayStr, startStr] = key.split('|');
    const when = `${dayStr} ${minutesToTime(Number(startStr))}`;
    const members = [...idSet]
      .map((id) => studentMap.get(id))
      .filter((s): s is Student => !!s);
    const groupSize = idSet.size;

    // Different classes → warn only. Class data is often missing from the roster,
    // so this is advisory; Amanda knows her students and can judge.
    const namedClasses = members
      .map((m) => m.className.trim())
      .filter((c) => c.length > 0);
    const distinctClasses = new Set(namedClasses);
    if (distinctClasses.size > 1) {
      errors.push({
        type: 'wrong_class_mix',
        severity: 'warning',
        message: `${members.map((m) => m.firstName).join(' & ')} may not be in the same class ${when} (${[...distinctClasses].join(', ')}) — check before grouping.`,
      });
    }

    // Per-member: individual-only, or group larger than the student allows.
    for (const m of members) {
      const maxSize = studentMaxGroupSize(m);
      if (maxSize === 0) {
        errors.push({
          type: 'group_size',
          severity: 'error',
          studentId: m.osisNumber,
          message: `${m.firstName} can't be grouped ${when} — mandate is individual only (1:1).`,
        });
      } else if (groupSize > maxSize) {
        errors.push({
          type: 'group_size',
          severity: 'error',
          studentId: m.osisNumber,
          message: `Group of ${groupSize} ${when} is too large for ${m.firstName} — mandate allows up to ${maxSize}.`,
        });
      }
    }
  }

  // Check provider double-bookings — two sessions the provider can't run at once.
  // Same slot (same start) is treated as one intended group, so only genuinely
  // overlapping sessions at DIFFERENT start times are flagged here.
  for (const s1 of sessions) {
    for (const s2 of sessions) {
      if (s1.id >= s2.id) continue;
      if (s1.day !== s2.day) continue;
      if (s1.startTime === s2.startTime) continue; // same slot = group, not a double-book
      if (!slotsOverlap(s1.startTime, s1.endTime, s2.startTime, s2.endTime)) continue;

      errors.push({
        type: 'double_booking',
        severity: 'error',
        sessionId: s1.id,
        message: `Provider has overlapping sessions on ${s1.day} at ${minutesToTime(s1.startTime)} and ${minutesToTime(s2.startTime)}.`,
      });
    }
  }

  // Check student double-bookings
  for (const s1 of sessions) {
    for (const s2 of sessions) {
      if (s1.id >= s2.id) continue;
      if (s1.day !== s2.day) continue;
      if (!slotsOverlap(s1.startTime, s1.endTime, s2.startTime, s2.endTime)) continue;

      const overlap = s1.studentIds.filter((id) => s2.studentIds.includes(id));
      for (const studentId of overlap) {
        const student = studentMap.get(studentId);
        errors.push({
          type: 'double_booking',
          severity: 'error',
          studentId,
          sessionId: s1.id,
          message: `${student?.firstName ?? studentId} double-booked on ${s1.day} at ${s1.startTime}`,
        });
      }
    }
  }

  // Check cross-provider conflicts
  for (const session of sessions) {
    for (const studentId of session.studentIds) {
      for (const conflict of conflicts) {
        if (conflict.studentId !== studentId) continue;
        if (conflict.day !== session.day) continue;
        if (!slotsOverlap(session.startTime, session.endTime, conflict.startTime, conflict.endTime)) continue;

        const student = studentMap.get(studentId);
        errors.push({
          type: 'cross_provider_conflict',
          severity: 'error',
          studentId,
          sessionId: session.id,
          message: `${student?.firstName ?? studentId} conflicts with ${conflict.otherProvider} on ${session.day}`,
        });
      }
    }
  }

  // Check lunch block usage
  for (const session of sessions) {
    if (slotsOverlap(session.startTime, session.endTime, config.lunchStart, config.lunchEnd)) {
      errors.push({
        type: 'time_overflow',
        severity: 'warning',
        sessionId: session.id,
        message: `Session on ${session.day} is during lunch/recess`,
      });
    }
  }

  // Check time boundaries
  for (const session of sessions) {
    if (session.endTime > config.endTime) {
      errors.push({
        type: 'time_overflow',
        severity: 'error',
        sessionId: session.id,
        message: `Session on ${session.day} extends past end time`,
      });
    } else if (session.endTime > config.preferredEndTime) {
      errors.push({
        type: 'time_overflow',
        severity: 'warning',
        sessionId: session.id,
        message: `Session on ${session.day} is in extended hours (after 3:30)`,
      });
    }
    if (!config.activeDays.includes(session.day)) {
      errors.push({
        type: 'time_overflow',
        severity: 'warning',
        sessionId: session.id,
        message: `Session scheduled on inactive day ${session.day}`,
      });
    }
  }

  return errors;
}

export interface StudentSessionSummary {
  totalScheduled: number; // sessions this student is in (any type)
  totalRequired: number; // sum of mandate frequencies
  groupedScheduled: number; // of those, how many are group sessions (>1 student)
  maxGroupSessions: number; // how many sessions MAY be grouped (0 = grouping not allowed)
  maxGroupSize: number; // largest allowed group size (capped at 3), 0 if grouping not allowed
  flexibleGroup: boolean; // true if any mandate uses ":group" (flexible size)
}

/**
 * Session totals for a student under the "grouping is optional, not required"
 * model: a mandate's `:N` is a *maximum* group size, not a required session type.
 * A student needs `totalRequired` sessions/week; any of them may be individual.
 * At most `maxGroupSessions` of them may be group sessions (size ≤ `maxGroupSize`).
 */
export function getStudentSessionSummary(
  student: Student,
  sessions: ScheduledSession[]
): StudentSessionSummary {
  const sid = student.osisNumber;
  const mine = sessions.filter((s) => s.studentIds.includes(sid));

  const totalRequired = student.mandateSessions.reduce((sum, m) => sum + m.frequency, 0);

  // Grouped = the student shares that slot with another student (co-location),
  // matching what the calendar shows — not just sessions whose own studentIds > 1.
  const occupancy = buildSlotOccupancy(sessions);
  const groupedScheduled = mine.filter(
    (s) => slotStudentCount(s.day, s.startTime, occupancy) > 1
  ).length;

  let maxGroupSessions = 0;
  let maxGroupSize = 0;
  let flexibleGroup = false;
  for (const m of student.mandateSessions) {
    const groupEligible = m.groupFlexible || m.groupSize > 1;
    if (!groupEligible) continue;
    maxGroupSessions += m.frequency;
    if (m.groupFlexible) flexibleGroup = true;
    const size = m.groupFlexible ? 3 : Math.min(m.groupSize, 3);
    if (size > maxGroupSize) maxGroupSize = size;
  }

  return {
    totalScheduled: mine.length,
    totalRequired,
    groupedScheduled,
    maxGroupSessions,
    maxGroupSize,
    flexibleGroup,
  };
}

export function getMandateProgress(
  student: Student,
  sessions: ScheduledSession[]
): { mandateIndex: number; scheduled: number; required: number }[] {
  const sid = student.osisNumber;
  return student.mandateSessions.map((ms, mi) => {
    const scheduled = sessions.filter(
      (s) => s.studentIds.includes(sid) && s.mandateIndices[sid] === mi
    ).length;
    return { mandateIndex: mi, scheduled, required: ms.frequency };
  });
}
