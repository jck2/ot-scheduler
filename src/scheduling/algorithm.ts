import type { AppConfig, Conflict, ScheduledSession, Student, TimeSlot } from '@/types';
import { decomposeMandates, type SessionRequest } from '@/parsing/mandateParser';
import { generateTimeSlots } from '@/utils/timeUtils';
import {
  checkActiveDay,
  checkNoCrossProviderConflict,
  checkNoDoubleBooking,
  checkProviderSlotFree,
  checkSameClassGroup,
  checkWednesdayEnd,
  scoreExtendedHours,
  scoreLunchPenalty,
  scoreSameDayDouble,
  scoreTimePenalty,
} from './constraints';

let nextId = 1;
function genId(): string {
  return `session-${nextId++}`;
}

export function generateSchedule(
  students: Student[],
  conflicts: Conflict[],
  config: AppConfig
): ScheduledSession[] {
  nextId = 1;
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));

  // 1. Decompose all mandates into individual session requests
  const allRequests: SessionRequest[] = [];
  for (const student of students) {
    const reqs = decomposeMandates(student.osisNumber, student.mandateSessions);
    allRequests.push(...reqs);
  }

  // 2. Group compatible requests (same class, compatible group sizes)
  const { grouped, individual } = groupRequests(allRequests, studentMap);

  // 3. Sort by difficulty: individual first, then pairs, then groups
  // Within type, students with more conflicts go first (they're harder to schedule)
  const conflictCount = new Map<string, number>();
  for (const c of conflicts) {
    conflictCount.set(c.studentId, (conflictCount.get(c.studentId) ?? 0) + 1);
  }

  individual.sort((a, b) => {
    const ca = conflictCount.get(a.studentId) ?? 0;
    const cb = conflictCount.get(b.studentId) ?? 0;
    return cb - ca;
  });

  grouped.sort((a, b) => {
    // Larger groups first — they're harder to place (more students must be free)
    if (a.length !== b.length) return b.length - a.length;
    // More conflicts first
    const ca = Math.max(...a.map((r) => conflictCount.get(r.studentId) ?? 0));
    const cb = Math.max(...b.map((r) => conflictCount.get(r.studentId) ?? 0));
    return cb - ca;
  });

  // 4. Generate time slots
  // All slots from startTime to endTime are available in one phase.
  // Lunch and extended-hours penalties are handled by soft constraints.
  const sessions: ScheduledSession[] = [];

  const allSlots = generateTimeSlots(
    config.startTime,
    config.endTime,
    config.slotDuration,
    config.activeDays
  );

  // Wednesday as a fallback if not already active
  const wednesdaySlots = config.activeDays.includes('Wednesday')
    ? []
    : generateTimeSlots(config.startTime, 810, config.slotDuration, ['Wednesday']);

  const slotPhases = [allSlots, wednesdaySlots];

  // Schedule grouped sessions first
  for (const group of grouped) {
    const scheduled = scheduleGroupedSession(
      group,
      sessions,
      conflicts,
      config,
      studentMap,
      slotPhases
    );
    if (scheduled) {
      sessions.push(scheduled);
    }
  }

  // Schedule individual sessions
  for (const request of individual) {
    const scheduled = scheduleIndividualSession(
      request,
      sessions,
      conflicts,
      config,
      studentMap,
      slotPhases
    );
    if (scheduled) {
      sessions.push(scheduled);
    }
  }

  return sessions;
}


function groupRequests(
  allRequests: SessionRequest[],
  studentMap: Map<string, Student>
): { grouped: SessionRequest[][]; individual: SessionRequest[] } {
  const individual: SessionRequest[] = [];
  const groupable: SessionRequest[] = [];

  for (const req of allRequests) {
    if (req.groupSize === 1) {
      individual.push(req);
    } else {
      groupable.push(req);
    }
  }

  // Group by class only — students with different groupSize/groupFlexible values
  // can still be grouped together as long as group size doesn't exceed any member's max
  const byClass = new Map<string, SessionRequest[]>();
  for (const req of groupable) {
    const student = studentMap.get(req.studentId);
    if (!student) continue;
    if (!byClass.has(student.className)) byClass.set(student.className, []);
    byClass.get(student.className)!.push(req);
  }

  const MAX_GROUP_SIZE = 3;

  const grouped: SessionRequest[][] = [];
  const leftoverSingles: SessionRequest[] = [];

  for (const [_cls, requests] of byClass) {
    // Sort by effective max ascending — most constrained requests first
    requests.sort((a, b) => {
      const aMax = a.groupFlexible ? MAX_GROUP_SIZE : Math.min(a.groupSize, MAX_GROUP_SIZE);
      const bMax = b.groupFlexible ? MAX_GROUP_SIZE : Math.min(b.groupSize, MAX_GROUP_SIZE);
      return aMax - bMax;
    });

    const assigned = new Set<number>();

    // First pass: form pairs only (cap at 2). We prefer more pairs over fewer trios.
    for (let i = 0; i < requests.length; i++) {
      if (assigned.has(i)) continue;

      const leader = requests[i];
      const group: SessionRequest[] = [leader];
      assigned.add(i);

      // Find exactly one partner to form a pair
      for (let j = i + 1; j < requests.length && group.length < 2; j++) {
        if (assigned.has(j)) continue;
        const candidate = requests[j];
        if (group.some((r) => r.studentId === candidate.studentId)) continue;
        // Both must allow at least size 2
        const leaderMax = leader.groupFlexible ? MAX_GROUP_SIZE : Math.min(leader.groupSize, MAX_GROUP_SIZE);
        const candidateMax = candidate.groupFlexible ? MAX_GROUP_SIZE : Math.min(candidate.groupSize, MAX_GROUP_SIZE);
        if (leaderMax >= 2 && candidateMax >= 2) {
          group.push(candidate);
          assigned.add(j);
        }
      }

      if (group.length >= 2) {
        grouped.push(group);
      } else {
        leftoverSingles.push(leader);
      }
    }
  }

  // Second pass: try to attach leftover singles to existing pairs (growing to max 3)
  for (const leftover of leftoverSingles) {
    const leftoverStudent = studentMap.get(leftover.studentId);
    if (!leftoverStudent) {
      individual.push(leftover);
      continue;
    }

    let attached = false;
    for (const group of grouped) {
      if (group.length >= MAX_GROUP_SIZE) continue;

      // Must be same class
      const groupStudent = studentMap.get(group[0].studentId);
      if (!groupStudent || groupStudent.className !== leftoverStudent.className) continue;

      // Don't put two requests from the same student in one group
      if (group.some((r) => r.studentId === leftover.studentId)) continue;

      // Check all members' max constraints allow the new size (capped at 3)
      const newSize = group.length + 1;
      const allAllow = group.every((r) => {
        const max = r.groupFlexible ? MAX_GROUP_SIZE : Math.min(r.groupSize, MAX_GROUP_SIZE);
        return newSize <= max;
      });
      const leftoverMax = leftover.groupFlexible ? MAX_GROUP_SIZE : Math.min(leftover.groupSize, MAX_GROUP_SIZE);
      if (allAllow && newSize <= leftoverMax) {
        group.push(leftover);
        attached = true;
        break;
      }
    }

    if (!attached) {
      individual.push(leftover);
    }
  }

  return { grouped, individual };
}

function scheduleGroupedSession(
  group: SessionRequest[],
  existing: ScheduledSession[],
  conflicts: Conflict[],
  config: AppConfig,
  studentMap: Map<string, Student>,
  slotPhases: TimeSlot[][]
): ScheduledSession | null {
  const studentIds = group.map((r) => r.studentId);
  let bestSlot: TimeSlot | null = null;
  let bestPenalty = Infinity;

  for (const slots of slotPhases) {
    for (const slot of slots) {
      // Hard constraints
      const dayOk = checkActiveDay(slot.day, config);
      if (!dayOk.satisfied && !slotPhases.indexOf(slots)) continue; // allow in relaxation phases
      if (slot.day === 'Wednesday') {
        const wedOk = checkWednesdayEnd(slot.day, slot.endTime);
        if (!wedOk.satisfied) continue;
      }

      // Provider can only run one session per slot
      const providerFree = checkProviderSlotFree(slot.day, slot.startTime, slot.endTime, existing);
      if (!providerFree.satisfied) continue;

      let allClear = true;
      let penalty = 0;

      for (const sid of studentIds) {
        const db = checkNoDoubleBooking(sid, slot.day, slot.startTime, slot.endTime, existing);
        if (!db.satisfied) { allClear = false; break; }

        const cp = checkNoCrossProviderConflict(sid, slot.day, slot.startTime, slot.endTime, conflicts);
        if (!cp.satisfied) { allClear = false; break; }

        penalty += scoreSameDayDouble(sid, slot.day, existing);
      }

      if (!allClear) continue;

      const classCheck = checkSameClassGroup(studentIds, studentMap);
      if (!classCheck.satisfied) continue;

      penalty += scoreLunchPenalty(slot.startTime, slot.endTime, config);
      penalty += scoreTimePenalty(slot.startTime, config);
      penalty += scoreExtendedHours(slot.startTime, slot.endTime, config);

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestSlot = slot;
      }
    }
    if (bestSlot) break; // Found a slot in this phase, no need to relax further
  }

  if (!bestSlot) return null;

  const mandateIndices: Record<string, number> = {};
  for (const req of group) {
    mandateIndices[req.studentId] = req.mandateIndex;
  }

  return {
    id: genId(),
    day: bestSlot.day,
    startTime: bestSlot.startTime,
    endTime: bestSlot.endTime,
    studentIds,
    mandateIndices,
    type: studentIds.length === 1 ? 'individual' : studentIds.length === 2 ? 'pair' : 'group',
    locked: false,
  };
}

function scheduleIndividualSession(
  request: SessionRequest,
  existing: ScheduledSession[],
  conflicts: Conflict[],
  config: AppConfig,
  _studentMap: Map<string, Student>,
  slotPhases: TimeSlot[][]
): ScheduledSession | null {
  let bestSlot: TimeSlot | null = null;
  let bestPenalty = Infinity;

  for (const slots of slotPhases) {
    for (const slot of slots) {
      if (slot.day === 'Wednesday') {
        const wedOk = checkWednesdayEnd(slot.day, slot.endTime);
        if (!wedOk.satisfied) continue;
      }

      // Provider can only run one session per slot
      const providerFree = checkProviderSlotFree(slot.day, slot.startTime, slot.endTime, existing);
      if (!providerFree.satisfied) continue;

      const db = checkNoDoubleBooking(
        request.studentId,
        slot.day,
        slot.startTime,
        slot.endTime,
        existing
      );
      if (!db.satisfied) continue;

      const cp = checkNoCrossProviderConflict(
        request.studentId,
        slot.day,
        slot.startTime,
        slot.endTime,
        conflicts
      );
      if (!cp.satisfied) continue;

      let penalty = 0;
      penalty += scoreLunchPenalty(slot.startTime, slot.endTime, config);
      penalty += scoreTimePenalty(slot.startTime, config);
      penalty += scoreExtendedHours(slot.startTime, slot.endTime, config);
      penalty += scoreSameDayDouble(request.studentId, slot.day, existing);

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestSlot = slot;
      }
    }
    if (bestSlot) break;
  }

  if (!bestSlot) return null;

  return {
    id: genId(),
    day: bestSlot.day,
    startTime: bestSlot.startTime,
    endTime: bestSlot.endTime,
    studentIds: [request.studentId],
    mandateIndices: { [request.studentId]: request.mandateIndex },
    type: 'individual',
    locked: false,
  };
}
