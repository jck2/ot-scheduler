import { describe, it, expect } from 'vitest';
import { generateSchedule } from '@/scheduling/algorithm';
import type { Student, DayOfWeek } from '@/types';
import { DEFAULT_CONFIG } from '@/utils/constants';

const makeStudent = (
  firstName: string,
  lastName: string,
  className: string,
  osis: string,
  mandateRaw: string
): Student => {
  // Quick parser inline for tests
  const sessions = mandateRaw.match(/(\d+)x(\d+)(?::(\d+|group))?/gi)?.map((m) => {
    const match = /(\d+)x(\d+)(?::(\d+|group))?/i.exec(m)!;
    const groupSpec = match[3]?.toLowerCase();
    return {
      frequency: parseInt(match[1]),
      duration: parseInt(match[2]),
      groupSize: !groupSpec ? 1 : groupSpec === 'group' ? Infinity : parseInt(groupSpec),
      groupFlexible: groupSpec === 'group',
    };
  }) ?? [];

  return {
    firstName,
    lastName,
    grade: 4,
    className,
    osisNumber: osis,
    mandateRaw,
    mandateSessions: sessions,
    provider: 'Amanda Huang',
  };
};

describe('generateSchedule', () => {
  it('schedules a single student with individual mandate', () => {
    const students = [makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '001', '2x30:1')];
    const schedule = generateSchedule(students, [], DEFAULT_CONFIG);

    expect(schedule).toHaveLength(2);
    expect(schedule[0].studentIds).toEqual(['001']);
    expect(schedule[0].type).toBe('individual');
  });

  it('groups pair mandates from same class', () => {
    const students = [
      makeStudent('Roger', 'Rush', 'Magnolia', '001', '1x30:2'),
      makeStudent('Asa', 'Penrose', 'Magnolia', '002', '1x30:2'),
    ];
    const schedule = generateSchedule(students, [], DEFAULT_CONFIG);

    // Should produce 1 pair session
    const pairSessions = schedule.filter((s) => s.studentIds.length === 2);
    expect(pairSessions.length).toBeGreaterThanOrEqual(1);
  });

  it('does not double-book students', () => {
    const students = [makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '001', '2x30:1')];
    const schedule = generateSchedule(students, [], DEFAULT_CONFIG);

    // Verify no time overlap for same student
    for (let i = 0; i < schedule.length; i++) {
      for (let j = i + 1; j < schedule.length; j++) {
        const s1 = schedule[i];
        const s2 = schedule[j];
        if (s1.day === s2.day && s1.studentIds[0] === s2.studentIds[0]) {
          const overlaps =
            s1.startTime < s2.endTime && s2.startTime < s1.endTime;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it('respects cross-provider conflicts', () => {
    const students = [makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '001', '2x30:1')];
    const conflicts = [
      {
        studentId: '001',
        studentName: 'Hugh Fuccillo',
        day: 'Monday' as DayOfWeek,
        startTime: 510,
        endTime: 540,
        otherProvider: 'Speech',
        description: 'Speech conflict',
      },
    ];
    const schedule = generateSchedule(students, conflicts, DEFAULT_CONFIG);

    // No session should be at Monday 8:30-9:00
    const conflicting = schedule.filter(
      (s) => s.day === 'Monday' && s.startTime === 510
    );
    expect(conflicting).toHaveLength(0);
  });

  it('schedules multiple students across days', () => {
    const students = [
      makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '001', '2x30:1'),
      makeStudent('Ryzen', 'Williams', 'Honeylocust', '002', '2x30:1'),
      makeStudent('Roger', 'Rush', 'Magnolia', '003', '2x30:1'),
    ];
    const schedule = generateSchedule(students, [], DEFAULT_CONFIG);

    // Should have 6 individual sessions
    expect(schedule).toHaveLength(6);

    // Should use multiple days
    const days = new Set(schedule.map((s) => s.day));
    expect(days.size).toBeGreaterThan(1);
  });

  it('never schedules two sessions in the same time slot (provider has one body)', () => {
    const students = [
      makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '001', '2x30:1'),
      makeStudent('Ryzen', 'Williams', 'Honeylocust', '002', '2x30:1'),
      makeStudent('Roger', 'Rush', 'Magnolia', '003', '2x30:1'),
      makeStudent('Asa', 'Penrose', 'Magnolia', '004', '2x30:1'),
      makeStudent('Alma', 'Prondak', 'Honeylocust', '005', '2x30:1'),
    ];
    const schedule = generateSchedule(students, [], DEFAULT_CONFIG);

    // No two sessions should overlap on the same day
    for (let i = 0; i < schedule.length; i++) {
      for (let j = i + 1; j < schedule.length; j++) {
        const s1 = schedule[i];
        const s2 = schedule[j];
        if (s1.day === s2.day) {
          const overlaps = s1.startTime < s2.endTime && s2.startTime < s1.endTime;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it('spreads sessions across different time slots', () => {
    const students = [
      makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '001', '2x30:1'),
      makeStudent('Ryzen', 'Williams', 'Honeylocust', '002', '2x30:1'),
      makeStudent('Roger', 'Rush', 'Magnolia', '003', '2x30:1'),
    ];
    const schedule = generateSchedule(students, [], DEFAULT_CONFIG);

    // Should use more than one time slot
    const timeSlots = new Set(schedule.map((s) => `${s.day}-${s.startTime}`));
    expect(timeSlots.size).toBe(schedule.length);
  });
});
