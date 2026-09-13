import { describe, it, expect } from 'vitest';
import { getStudentSessionSummary } from '@/scheduling/validator';
import { parseMandate } from '@/parsing/mandateParser';
import type { ScheduledSession, Student } from '@/types';

function student(mandateRaw: string): Student {
  return {
    firstName: 'Test',
    lastName: 'Kid',
    grade: 5,
    className: 'Elm',
    osisNumber: 'sid1',
    mandateRaw,
    mandateSessions: parseMandate(mandateRaw),
    provider: 'Amanda Huang',
  };
}

let counter = 0;
// startTime defaults to a unique slot per session so sessions are NOT co-located
// unless a test deliberately gives two sessions the same startTime.
function session(studentIds: string[], startTime = 540 + counter * 30): ScheduledSession {
  const type = studentIds.length === 1 ? 'individual' : studentIds.length === 2 ? 'pair' : 'group';
  return {
    id: `s${counter++}`,
    day: 'Monday',
    startTime,
    endTime: startTime + 30,
    studentIds,
    mandateIndices: Object.fromEntries(studentIds.map((id) => [id, 0])),
    type,
    locked: false,
  };
}

describe('getStudentSessionSummary', () => {
  it('counts total required as the sum of frequencies', () => {
    const sum = getStudentSessionSummary(student('2x30:1, 1x30:3'), []);
    expect(sum.totalRequired).toBe(3);
    expect(sum.totalScheduled).toBe(0);
    expect(sum.maxGroupSessions).toBe(1); // only the 1x30:3 is group-eligible
    expect(sum.maxGroupSize).toBe(3);
    expect(sum.flexibleGroup).toBe(false);
  });

  it('treats all-individual as valid: total met, not over-grouped', () => {
    const s = student('2x30:1, 1x30:3');
    const sessions = [session(['sid1']), session(['sid1']), session(['sid1'])];
    const sum = getStudentSessionSummary(s, sessions);
    expect(sum.totalScheduled).toBe(3);
    expect(sum.groupedScheduled).toBe(0);
    expect(sum.groupedScheduled > sum.maxGroupSessions).toBe(false);
  });

  it('counts group sessions within the allowance', () => {
    const s = student('2x30:1, 1x30:3');
    const sessions = [session(['sid1']), session(['sid1']), session(['sid1', 'other'])];
    const sum = getStudentSessionSummary(s, sessions);
    expect(sum.groupedScheduled).toBe(1);
    expect(sum.groupedScheduled > sum.maxGroupSessions).toBe(false); // 1 <= 1
  });

  it('flags over-grouping when grouped more than allowed', () => {
    const s = student('2x30:1, 1x30:3');
    const sessions = [
      session(['sid1']),
      session(['sid1', 'a']),
      session(['sid1', 'b']),
    ];
    const sum = getStudentSessionSummary(s, sessions);
    expect(sum.groupedScheduled).toBe(2);
    expect(sum.maxGroupSessions).toBe(1);
    expect(sum.groupedScheduled > sum.maxGroupSessions).toBe(true);
  });

  it('counts co-location: two SEPARATE sessions in one slot are a group', () => {
    const s = student('1x30:3');
    // sid1 alone in one session, but another student sits in the same slot (600).
    const sessions = [session(['sid1'], 600), session(['other'], 600)];
    const sum = getStudentSessionSummary(s, sessions);
    expect(sum.groupedScheduled).toBe(1);
    expect(sum.groupedScheduled > sum.maxGroupSessions).toBe(false);
  });

  it('individual-only mandate → no grouping allowed', () => {
    const sum = getStudentSessionSummary(student('2x30:1'), []);
    expect(sum.maxGroupSessions).toBe(0);
    expect(sum.maxGroupSize).toBe(0);
  });

  it('flexible ":group" mandate → flexible flag, size capped at 3', () => {
    const sum = getStudentSessionSummary(student('1x30:group'), []);
    expect(sum.maxGroupSessions).toBe(1);
    expect(sum.flexibleGroup).toBe(true);
    expect(sum.maxGroupSize).toBe(3);
  });

  it('":2" mandate caps group size at 2', () => {
    const sum = getStudentSessionSummary(student('2x30:2'), []);
    expect(sum.maxGroupSessions).toBe(2);
    expect(sum.maxGroupSize).toBe(2);
  });
});
