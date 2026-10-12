import { describe, it, expect } from 'vitest';
import {
  cellForbidden,
  rulesActive,
  sessionViolatesRules,
} from '@/scheduling/availability';
import { generateSchedule } from '@/scheduling/algorithm';
import { validateSchedule } from '@/scheduling/validator';
import { DEFAULT_CONFIG } from '@/utils/constants';
import type { ScheduledSession, Student, StudentRules } from '@/types';

function student(firstName: string, osisNumber: string, mandateRaw: string): Student {
  return {
    firstName,
    lastName: 'Test',
    grade: 5,
    className: '',
    osisNumber,
    mandateRaw,
    mandateSessions: [],
    provider: 'Amanda Huang',
  };
}

// parseMandate is applied by the roster parser; for scheduler tests we set
// mandateSessions directly.
function withMandate(s: Student, sessions: Student['mandateSessions']): Student {
  return { ...s, mandateSessions: sessions };
}

describe('availability — pure evaluation', () => {
  it('rulesActive is false for undefined / disabled / empty', () => {
    expect(rulesActive(undefined)).toBe(false);
    expect(rulesActive({ studentId: 'x', enabled: false, block: { Monday: [540] } })).toBe(false);
    expect(rulesActive({ studentId: 'x', enabled: true })).toBe(false);
    expect(rulesActive({ studentId: 'x', enabled: true, allow: {}, block: {} })).toBe(false);
  });

  it('block cell is forbidden', () => {
    const r: StudentRules = { studentId: 'x', enabled: true, block: { Monday: [540] } };
    expect(cellForbidden(r, 'Monday', 540)).toBe(true);
    expect(cellForbidden(r, 'Monday', 570)).toBe(false);
    expect(cellForbidden(r, 'Tuesday', 540)).toBe(false);
  });

  it('allow-only forbids everything not explicitly allowed', () => {
    const r: StudentRules = { studentId: 'x', enabled: true, allow: { Monday: [540, 570] } };
    expect(cellForbidden(r, 'Monday', 540)).toBe(false);
    expect(cellForbidden(r, 'Monday', 600)).toBe(true); // not allowed
    expect(cellForbidden(r, 'Tuesday', 540)).toBe(true); // whole other day not allowed
  });

  it('combined: block wins, allow still restricts', () => {
    const r: StudentRules = {
      studentId: 'x',
      enabled: true,
      allow: { Monday: [540, 570] },
      block: { Monday: [540] },
    };
    expect(cellForbidden(r, 'Monday', 540)).toBe(true); // blocked
    expect(cellForbidden(r, 'Monday', 570)).toBe(false); // allowed, not blocked
    expect(cellForbidden(r, 'Monday', 600)).toBe(true); // not in allow
  });

  it('disabled record forbids nothing', () => {
    const r: StudentRules = { studentId: 'x', enabled: false, block: { Monday: [540] } };
    expect(cellForbidden(r, 'Monday', 540)).toBe(false);
  });

  it('a multi-cell session is a violation if any of its cells is forbidden', () => {
    const r: StudentRules = { studentId: 'x', enabled: true, block: { Monday: [570] } };
    // 540–600 spans cells 540 and 570; 570 is blocked.
    expect(sessionViolatesRules(r, { day: 'Monday', startTime: 540, endTime: 600 }, 30)).toBe(true);
    expect(sessionViolatesRules(r, { day: 'Monday', startTime: 540, endTime: 570 }, 30)).toBe(false);
  });
});

describe('availability — scheduler respects rules', () => {
  const config = { ...DEFAULT_CONFIG };
  const s = withMandate(student('Blake', 'b1', '1x30:1'), [
    { frequency: 1, duration: 30, groupSize: 1, groupFlexible: false },
  ]);

  it('never places a student in a blocked cell', () => {
    // Block every Monday/Tuesday/Thursday morning slot before 15:00 would be too
    // broad; instead block the single earliest slot and confirm it is avoided.
    const rules: StudentRules[] = [
      { studentId: 'b1', enabled: true, block: { Monday: [config.startTime] } },
    ];
    const sessions = generateSchedule([s], [], config, rules);
    expect(sessions.length).toBe(1);
    const placed = sessions[0];
    const forbidden = placed.day === 'Monday' && placed.startTime === config.startTime;
    expect(forbidden).toBe(false);
  });

  it('allow-only keeps the student inside allowed cells', () => {
    const rules: StudentRules[] = [
      { studentId: 'b1', enabled: true, allow: { Thursday: [600] } },
    ];
    const sessions = generateSchedule([s], [], config, rules);
    expect(sessions.length).toBe(1);
    expect(sessions[0].day).toBe('Thursday');
    expect(sessions[0].startTime).toBe(600);
  });
});

describe('availability — validator flags violations', () => {
  const config = { ...DEFAULT_CONFIG };
  const s = withMandate(student('Blake', 'b1', '1x30:1'), [
    { frequency: 1, duration: 30, groupSize: 1, groupFlexible: false },
  ]);
  const session: ScheduledSession = {
    id: 'sess-1',
    day: 'Monday',
    startTime: 540,
    endTime: 570,
    studentIds: ['b1'],
    mandateIndices: { b1: 0 },
    locked: false,
  };

  it('emits a custom_availability error scoped to the session + student', () => {
    const rules: StudentRules[] = [
      { studentId: 'b1', enabled: true, block: { Monday: [540] } },
    ];
    const errors = validateSchedule([session], [s], [], config, rules);
    const custom = errors.filter((e) => e.type === 'custom_availability');
    expect(custom.length).toBe(1);
    expect(custom[0].severity).toBe('error');
    expect(custom[0].sessionId).toBe('sess-1');
    expect(custom[0].studentId).toBe('b1');
  });

  it('allowed placement yields no custom_availability error', () => {
    const rules: StudentRules[] = [
      { studentId: 'b1', enabled: true, allow: { Monday: [540] } },
    ];
    const errors = validateSchedule([session], [s], [], config, rules);
    expect(errors.some((e) => e.type === 'custom_availability')).toBe(false);
  });

  it('rules re-attach by OSIS regardless of the students array identity', () => {
    // Simulate a re-import: a fresh Student object with the same OSIS. The rule,
    // keyed by OSIS, still matches.
    const reimported = withMandate(student('Blake', 'b1', '1x30:1'), [
      { frequency: 1, duration: 30, groupSize: 1, groupFlexible: false },
    ]);
    const rules: StudentRules[] = [
      { studentId: 'b1', enabled: true, block: { Monday: [540] } },
    ];
    const errors = validateSchedule([session], [reimported], [], config, rules);
    expect(errors.some((e) => e.type === 'custom_availability')).toBe(true);
  });
});
