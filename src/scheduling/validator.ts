import type { AppConfig, Conflict, ScheduledSession, Student, ValidationError } from '@/types';
import { slotsOverlap } from '@/utils/timeUtils';

export function validateSchedule(
  sessions: ScheduledSession[],
  students: Student[],
  conflicts: Conflict[],
  config: AppConfig
): ValidationError[] {
  const errors: ValidationError[] = [];
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));

  // Check mandate fulfillment per student
  for (const student of students) {
    const sid = student.osisNumber;
    for (let mi = 0; mi < student.mandateSessions.length; mi++) {
      const mandate = student.mandateSessions[mi];
      const matchingSessions = sessions.filter(
        (s) => s.studentIds.includes(sid) && s.mandateIndices[sid] === mi
      );

      if (matchingSessions.length < mandate.frequency) {
        errors.push({
          type: 'unmet_mandate',
          severity: 'error',
          studentId: sid,
          message: `${student.firstName} ${student.lastName}: needs ${mandate.frequency} session(s) for mandate #${mi + 1}, has ${matchingSessions.length}`,
        });
      }

      // Check group sizes — groupSize is a maximum, not exact
      for (const sess of matchingSessions) {
        const sessSize = sess.studentIds.length;
        if (mandate.groupSize === 1 && sessSize > 1) {
          errors.push({
            type: 'group_size',
            severity: 'error',
            studentId: sid,
            sessionId: sess.id,
            message: `${student.firstName}: individual mandate but session has ${sessSize} students`,
          });
        }
        // Only flag if session EXCEEDS the allowed group size
        if (mandate.groupSize > 1 && sessSize > mandate.groupSize && !mandate.groupFlexible) {
          errors.push({
            type: 'group_size',
            severity: 'error',
            studentId: sid,
            sessionId: sess.id,
            message: `${student.firstName}: mandate allows up to ${mandate.groupSize}, session has ${sessSize}`,
          });
        }
      }
    }
  }

  // Check provider double-bookings (provider can only run one session at a time)
  for (const s1 of sessions) {
    for (const s2 of sessions) {
      if (s1.id >= s2.id) continue;
      if (s1.day !== s2.day) continue;
      if (!slotsOverlap(s1.startTime, s1.endTime, s2.startTime, s2.endTime)) continue;

      errors.push({
        type: 'double_booking',
        severity: 'error',
        sessionId: s1.id,
        message: `Provider has overlapping sessions on ${s1.day}: two sessions at ${s1.startTime}`,
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

  // Check same-class grouping
  for (const session of sessions) {
    if (session.studentIds.length <= 1) continue;
    const classes = new Set<string>();
    for (const id of session.studentIds) {
      const s = studentMap.get(id);
      if (s) classes.add(s.className);
    }
    if (classes.size > 1) {
      errors.push({
        type: 'wrong_class_mix',
        severity: 'error',
        sessionId: session.id,
        message: `Session mixes classes: ${Array.from(classes).join(', ')}`,
      });
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
