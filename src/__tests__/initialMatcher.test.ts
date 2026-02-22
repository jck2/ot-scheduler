import { describe, it, expect } from 'vitest';
import { matchInitials } from '@/parsing/initialMatcher';
import type { Student } from '@/types';

const makeStudent = (firstName: string, lastName: string, className: string, osis: string): Student => ({
  firstName,
  lastName,
  grade: 4,
  className,
  osisNumber: osis,
  mandateRaw: '2x30:1',
  mandateSessions: [{ frequency: 2, duration: 30, groupSize: 1, groupFlexible: false }],
  provider: 'Amanda Huang',
});

const STUDENTS: Student[] = [
  makeStudent('Hugh', 'Fuccillo', 'Honeylocust', '248-960-940'),
  makeStudent('Ryzen', 'Williams', 'Honeylocust', '247-636-186'),
  makeStudent('Roger', 'Rush', 'Magnolia', '249-105-438'),
  makeStudent('Asa', 'Penrose', 'Magnolia', '251-575-809'),
  makeStudent('Alma', 'Prondak', 'Honeylocust', '252-774-773'),
  makeStudent('Anna Poppy', 'Vidal', 'Honeylocust', '247-718-299'),
  makeStudent('Juniper', 'Sober', 'Honeylocust', '250-489-440'),
  makeStudent('Joichi', 'Santise', 'Honeylocust', '250-483-492'),
];

describe('matchInitials', () => {
  it('resolves known exact initials', () => {
    const result = matchInitials(['HF'], STUDENTS);
    expect(result[0].confidence).toBe('exact');
    expect(result[0].studentId).toBe('248-960-940');
  });

  it('resolves known ambiguous initials (AP)', () => {
    const result = matchInitials(['AP'], STUDENTS);
    expect(result[0].confidence).toBe('ambiguous');
    expect(result[0].candidates?.length).toBeGreaterThan(1);
  });

  it('resolves 3-letter initial JuS', () => {
    const result = matchInitials(['JuS'], STUDENTS);
    expect(result[0].confidence).toBe('exact');
    expect(result[0].studentId).toBe('250-489-440');
  });

  it('resolves special PV → Anna Poppy Vidal', () => {
    const result = matchInitials(['PV'], STUDENTS);
    expect(result[0].confidence).toBe('exact');
    expect(result[0].studentId).toBe('247-718-299');
  });

  it('flags unknown initials', () => {
    const result = matchInitials(['MF'], STUDENTS);
    expect(result[0].confidence).toBe('unknown');
    expect(result[0].studentId).toBe('');
  });

  it('resolves JS → Joichi Santise', () => {
    const result = matchInitials(['JS'], STUDENTS);
    expect(result[0].confidence).toBe('exact');
    expect(result[0].studentId).toBe('250-483-492');
  });
});
