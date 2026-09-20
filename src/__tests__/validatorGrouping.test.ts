import { describe, it, expect } from 'vitest';
import { validateSchedule, errorAppliesToCard } from '@/scheduling/validator';
import { parseMandate } from '@/parsing/mandateParser';
import { DEFAULT_CONFIG } from '@/utils/constants';
import type { ScheduledSession, Student } from '@/types';

function student(first: string, osis: string, className: string, mandateRaw: string): Student {
  return {
    firstName: first,
    lastName: 'X',
    grade: 5,
    className,
    osisNumber: osis,
    mandateRaw,
    mandateSessions: parseMandate(mandateRaw),
    provider: 'Amanda Huang',
  };
}

let n = 0;
function slot(studentIds: string[], startTime: number): ScheduledSession {
  return {
    id: `s${n++}`,
    day: 'Monday',
    startTime,
    endTime: startTime + 30,
    studentIds,
    mandateIndices: Object.fromEntries(studentIds.map((id) => [id, 0])),
    locked: false,
  };
}

const messages = (errs: ReturnType<typeof validateSchedule>) => errs.map((e) => e.message).join(' | ');

describe('validator — co-location grouping messages', () => {
  it('warns (not errors) when grouped students have different named classes', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3');
    const b = student('Ben', 'b', 'Pine', '1x30:3');
    // Two separate sessions co-located in the same slot = one intended group.
    const sessions = [slot(['a'], 540), slot(['b'], 540)];
    const errs = validateSchedule(sessions, [a, b], [], DEFAULT_CONFIG);
    const classIssue = errs.find((e) => e.type === 'wrong_class_mix');
    expect(classIssue?.severity).toBe('warning');
    expect(classIssue?.message).toMatch(/same class/i);
  });

  it('does NOT flag class mix when class data is missing (blank)', () => {
    const a = student('Ana', 'a', '', '1x30:3');
    const b = student('Ben', 'b', '', '1x30:3');
    const errs = validateSchedule([slot(['a', 'b'], 540)], [a, b], [], DEFAULT_CONFIG);
    expect(errs.some((e) => e.type === 'wrong_class_mix')).toBe(false);
  });

  it('warns (not errors) about an individual-only student placed in a group', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:1'); // individual only
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const errs = validateSchedule([slot(['a', 'b'], 540)], [a, b], [], DEFAULT_CONFIG);
    const issue = errs.find((e) => /individual-only mandate/i.test(e.message));
    expect(issue?.severity).toBe('warning');
  });

  it('warns about a group larger than a student allows', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:2'); // max pair
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const c = student('Cy', 'c', 'Elm', '1x30:3');
    const errs = validateSchedule([slot(['a', 'b', 'c'], 540)], [a, b, c], [], DEFAULT_CONFIG);
    const issue = errs.find((e) => /larger than Ana's mandate allows/i.test(e.message));
    expect(issue?.severity).toBe('warning');
  });

  it('warns (not errors) about a student grouped more times than the cap', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3'); // allows 1 group session
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const c = student('Cy', 'c', 'Elm', '2x30:3');
    // Ana in two grouped slots on different days → over her cap of 1.
    const sessions = [slot(['a', 'b'], 540), { ...slot(['a', 'c'], 540), day: 'Tuesday' as const }];
    const errs = validateSchedule(sessions, [a, b, c], [], DEFAULT_CONFIG);
    const issue = errs.find((e) => /Ana is in 2 group session.*at most 1/i.test(e.message));
    expect(issue?.severity).toBe('warning');
  });

  it('errors once per cell when a student is scheduled twice on the same day', () => {
    const a = student('Ana', 'a', 'Elm', '2x30:1');
    const s1 = slot(['a'], 540);
    const s2 = slot(['a'], 600);
    const errs = validateSchedule([s1, s2], [a], [], DEFAULT_CONFIG);
    const sameDay = errs.filter((e) => /also scheduled at/i.test(e.message));
    expect(sameDay).toHaveLength(2);
    expect(sameDay.every((e) => e.severity === 'error')).toBe(true);
    // Each error names its own cell and points at the other time.
    expect(errorAppliesToCard(sameDay.find((e) => e.sessionId === s1.id)!, s1.id, 'a')).toBe(true);
    expect(errorAppliesToCard(sameDay.find((e) => e.sessionId === s1.id)!, s2.id, 'a')).toBe(false);
  });

  it('does NOT flag a valid same-class group within caps', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3');
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const sessions = [slot(['a', 'b'], 540)];
    const errs = validateSchedule(sessions, [a, b], [], DEFAULT_CONFIG);
    expect(errs.filter((e) => e.type === 'group_size' || e.type === 'wrong_class_mix')).toHaveLength(0);
  });

  it('does NOT flag a student with a mixed mandate (1x30:1, 2x30:2) placed in a group', () => {
    // Bug 3: both students have an individual AND a group-eligible mandate.
    const a = student('Xavier', 'a', 'Elm', '1x30:1, 2x30:2');
    const b = student('Roger', 'b', 'Elm', '1x30:1, 2x30:2');
    const errs = validateSchedule([slot(['a', 'b'], 540)], [a, b], [], DEFAULT_CONFIG);
    expect(errs.some((e) => /individual only/i.test(e.message))).toBe(false);
    expect(errs.filter((e) => e.type === 'group_size')).toHaveLength(0);
  });

  it('does NOT flag a "1x30: group" (space) student placed in a group', () => {
    const a = student('Asa', 'a', 'Elm', '1x30: group');
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const errs = validateSchedule([slot(['a', 'b'], 540)], [a, b], [], DEFAULT_CONFIG);
    expect(errs.some((e) => /individual only/i.test(e.message))).toBe(false);
  });

  it('treats same-slot students as a group, not a provider double-booking', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3');
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const sessions = [slot(['a'], 540), slot(['b'], 540)];
    const errs = validateSchedule(sessions, [a, b], [], DEFAULT_CONFIG);
    expect(errs.filter((e) => e.type === 'double_booking')).toHaveLength(0);
  });

  it('a cross-provider conflict rings only the conflicting card, not the student’s other cards', () => {
    const a = student('Arahli', 'a', 'Elm', '2x30:1');
    const conflictSlot = slot(['a'], 540);
    const cleanSlot = slot(['a'], 600);
    const conflicts = [
      {
        studentId: 'a',
        studentName: 'Arahli X',
        day: 'Monday' as const,
        startTime: 540,
        endTime: 570,
        otherProvider: 'SETSS',
        description: 'x',
      },
    ];
    const errs = validateSchedule([conflictSlot, cleanSlot], [a], conflicts, DEFAULT_CONFIG);
    const cp = errs.find((e) => e.type === 'cross_provider_conflict')!;
    expect(errorAppliesToCard(cp, conflictSlot.id, 'a')).toBe(true);
    expect(errorAppliesToCard(cp, cleanSlot.id, 'a')).toBe(false);
  });

  it('an over-cap warning rings grouped cards but not the student’s individual card', () => {
    const a = student('Kalena', 'a', 'Elm', '1x30:3'); // 1 group allowed
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const c = student('Cy', 'c', 'Elm', '1x30:3');
    const grouped1 = slot(['a', 'b'], 540);
    const grouped2 = { ...slot(['a', 'c'], 540), day: 'Tuesday' as const };
    const solo = { ...slot(['a'], 600), day: 'Thursday' as const };
    const errs = validateSchedule([grouped1, grouped2, solo], [a, b, c], [], DEFAULT_CONFIG);
    const overCap = errs.find((e) => /is in 2 group session/i.test(e.message))!;
    expect(overCap.severity).toBe('warning');
    expect(errorAppliesToCard(overCap, grouped1.id, 'a')).toBe(true);
    expect(errorAppliesToCard(overCap, grouped2.id, 'a')).toBe(true);
    expect(errorAppliesToCard(overCap, solo.id, 'a')).toBe(false); // individual card unaffected
  });

  it('warns when a restricted class is scheduled in its unavailable time band', () => {
    const pine = student('Pat', 'a', 'Pine', '1x30:1');
    const honey = student('Hank', 'b', 'Honeylocust', '1x30:1');
    const elm = student('Ed', 'c', 'Elm', '1x30:1');
    const mag = student('Mo', 'd', 'Magnolia', '1x30:1');
    // 10–11 band (600/630) forbids Pine + Honeylocust; 11–12 (660/690) forbids Elm + Magnolia.
    const sessions = [
      slot(['a'], 600), // Pine @10:00 -> warn
      slot(['b'], 630), // Honeylocust @10:30 -> warn
      slot(['c'], 660), // Elm @11:00 -> warn
      slot(['d'], 690), // Magnolia @11:30 -> warn
    ];
    const errs = validateSchedule(sessions, [pine, honey, elm, mag], [], DEFAULT_CONFIG);
    const bandWarnings = errs.filter((e) => e.type === 'class_unavailable');
    expect(bandWarnings).toHaveLength(4);
    expect(bandWarnings.every((e) => e.severity === 'warning')).toBe(true);
  });

  it('does NOT warn when the class is fine for that band (or outside any band)', () => {
    const pine = student('Pat', 'a', 'Pine', '1x30:1');
    const elm = student('Ed', 'c', 'Elm', '1x30:1');
    const sessions = [
      slot(['a'], 660), // Pine @11:00 -> band B forbids Elm/Magnolia, Pine OK
      slot(['c'], 600), // Elm @10:00 -> band A forbids Pine/Honeylocust, Elm OK
      slot(['a'], 540), // Pine @9:00 -> no band
    ];
    const errs = validateSchedule(sessions, [pine, elm], [], DEFAULT_CONFIG);
    expect(errs.some((e) => e.type === 'class_unavailable')).toBe(false);
  });

  it('still flags a provider overlap at a different start time', () => {
    const a = student('Ana', 'a', 'Elm', '2x30:1');
    // Two sessions that overlap but start at different times.
    const s1: ScheduledSession = { ...slot(['a'], 540), endTime: 600 };
    const s2 = slot(['a'], 570);
    const errs = validateSchedule([s1, s2], [a], [], DEFAULT_CONFIG);
    expect(errs.some((e) => e.type === 'double_booking')).toBe(true);
  });
});
