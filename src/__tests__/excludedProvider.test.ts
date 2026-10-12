import { describe, it, expect } from 'vitest';
import { isExcludedProvider } from '@/utils/constants';
import { detectCrossProviderConflicts } from '@/scheduling/conflictDetector';
import type { ProviderSchedule, Student } from '@/types';

function student(firstName: string, lastName: string, osisNumber: string): Student {
  return {
    firstName,
    lastName,
    grade: 5,
    className: '',
    osisNumber,
    mandateRaw: '',
    mandateSessions: [],
    provider: 'Amanda Huang',
  };
}

describe('isExcludedProvider', () => {
  it('matches Elizabeth Grosser by sheet or provider name, case-insensitively', () => {
    expect(isExcludedProvider('Grosser')).toBe(true);
    expect(isExcludedProvider('Counseling - Grosser')).toBe(true);
    expect(isExcludedProvider('x', 'Elizabeth Grosser')).toBe(true);
  });

  it('does not match real-overlap providers', () => {
    expect(isExcludedProvider('Ayana Jenkins')).toBe(false);
    expect(isExcludedProvider('Rosa Perez')).toBe(false);
    expect(isExcludedProvider(null, undefined)).toBe(false);
  });
});

describe('detectCrossProviderConflicts — excluded provider', () => {
  // Roster initials MM / SC collide with Grosser's own students.
  const roster = [
    student('Magritte', 'Mittnacht', 'a1'),
    student('Sarah', 'Charles', 'a2'),
    student('Roger', 'Rush', 'a3'),
  ];

  const grosser: ProviderSchedule = {
    providerName: 'Elizabeth Grosser',
    sheetName: 'Grosser',
    sessions: [
      { day: 'Monday', startTime: 540, endTime: 570, studentNames: ['MM'], rawText: 'MM' },
      { day: 'Tuesday', startTime: 600, endTime: 630, studentNames: ['SC'], rawText: 'SC' },
    ],
  };

  const speech: ProviderSchedule = {
    providerName: 'Rosa Perez',
    sheetName: 'Rosa Perez',
    sessions: [
      { day: 'Monday', startTime: 540, endTime: 570, studentNames: ['Roger'], rawText: 'Roger' },
    ],
  };

  it('drops phantom overlap from Grosser but keeps a real first-name match', () => {
    const conflicts = detectCrossProviderConflicts(
      roster,
      [grosser, speech],
      'OT Amanda'
    );
    expect(conflicts.map((c) => c.otherProvider)).not.toContain('Elizabeth Grosser');
    expect(conflicts.some((c) => c.studentId === 'a3')).toBe(true);
  });
});
