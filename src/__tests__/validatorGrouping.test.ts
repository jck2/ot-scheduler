import { describe, it, expect } from 'vitest';
import { validateSchedule } from '@/scheduling/validator';
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
    type: studentIds.length === 1 ? 'individual' : studentIds.length === 2 ? 'pair' : 'group',
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

  it('flags an individual-only student placed in a group', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:1'); // individual only
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const sessions = [slot(['a', 'b'], 540)];
    const errs = validateSchedule(sessions, [a, b], [], DEFAULT_CONFIG);
    expect(messages(errs)).toMatch(/Ana can't be grouped.*individual only/i);
  });

  it('flags a group larger than a student allows', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:2'); // max pair
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const c = student('Cy', 'c', 'Elm', '1x30:3');
    const sessions = [slot(['a', 'b', 'c'], 540)]; // group of 3
    const errs = validateSchedule(sessions, [a, b, c], [], DEFAULT_CONFIG);
    expect(messages(errs)).toMatch(/too large for Ana.*up to 2/i);
  });

  it('flags a student grouped more times than the cap', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3'); // allows 1 group session
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const c = student('Cy', 'c', 'Elm', '2x30:3');
    // Ana in two grouped slots → over her cap of 1.
    const sessions = [slot(['a', 'b'], 540), slot(['a', 'c'], 570)];
    const errs = validateSchedule(sessions, [a, b, c], [], DEFAULT_CONFIG);
    expect(messages(errs)).toMatch(/Ana is in 2 group session.*at most 1/i);
  });

  it('does NOT flag a valid same-class group within caps', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3');
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const sessions = [slot(['a', 'b'], 540)];
    const errs = validateSchedule(sessions, [a, b], [], DEFAULT_CONFIG);
    expect(errs.filter((e) => e.type === 'group_size' || e.type === 'wrong_class_mix')).toHaveLength(0);
  });

  it('treats same-slot students as a group, not a provider double-booking', () => {
    const a = student('Ana', 'a', 'Elm', '1x30:3');
    const b = student('Ben', 'b', 'Elm', '1x30:3');
    const sessions = [slot(['a'], 540), slot(['b'], 540)];
    const errs = validateSchedule(sessions, [a, b], [], DEFAULT_CONFIG);
    expect(errs.filter((e) => e.type === 'double_booking')).toHaveLength(0);
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
