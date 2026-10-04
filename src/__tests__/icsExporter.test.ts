import { describe, it, expect } from 'vitest';
import { buildIcs, buildProviderIcs, buildReadme, recurrenceWindow } from '@/export/icsExporter';
import type { ProviderSchedule, ScheduledSession, Student } from '@/types';

function student(first: string, last: string, osis: string): Student {
  return {
    firstName: first,
    lastName: last,
    grade: 3,
    className: 'Elm',
    osisNumber: osis,
    mandateRaw: '1x30:1',
    mandateSessions: [{ frequency: 1, duration: 30, groupSize: 1 }],
    provider: 'Amanda Huang',
  };
}

function session(id: string, day: ScheduledSession['day'], start: number, studentIds: string[]): ScheduledSession {
  return {
    id,
    day,
    startTime: start,
    endTime: start + 30,
    studentIds,
    mandateIndices: Object.fromEntries(studentIds.map((s) => [s, 0])),
    locked: false,
  };
}

const NOW = new Date(2026, 9, 7); // Wed Oct 7 2026 — "export day"

describe('buildIcs', () => {
  const students = [student('Ana', 'Brown', 'a'), student('Ben', 'Cole', 'b')];

  it('wraps events in a VCALENDAR with a VTIMEZONE and no METHOD', () => {
    const ics = buildIcs([session('s1', 'Monday', 540, ['a'])], students, undefined, undefined, NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/New_York');
    expect(ics).not.toMatch(/METHOD:/);
  });

  it('uses CRLF line endings throughout', () => {
    const ics = buildIcs([session('s1', 'Monday', 540, ['a'])], students, undefined, undefined, NOW);
    expect(ics.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(ics)).toBe(false); // no bare LF
  });

  it('pins DTSTART/DTEND to the Eastern timezone (not floating, not Z)', () => {
    const ics = buildIcs([session('s1', 'Monday', 540, ['a'])], students, undefined, undefined, NOW);
    expect(ics).toMatch(/DTSTART;TZID=America\/New_York:\d{8}T090000\r\n/);
    expect(ics).toMatch(/DTEND;TZID=America\/New_York:\d{8}T093000\r\n/);
  });

  it('anchors recurrence to the Monday on/after the export date', () => {
    // NOW = Wed Oct 7 2026 → upcoming Monday = Oct 12; a Thursday session → Oct 15.
    const ics = buildIcs([session('s1', 'Thursday', 600, ['a'])], students, undefined, undefined, NOW);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261015T100000');
  });

  it('ignores a stale (past) term start and end', () => {
    // Last year's dates — must NOT be used; events should still start this coming week.
    const ics = buildIcs(
      [session('s1', 'Monday', 540, ['a'])],
      students,
      '2025-09-08',
      '2026-06-26',
      NOW
    );
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261012T090000');
    // Default end-of-school-year UNTIL (June 30 2027), in UTC.
    expect(ics).toContain('UNTIL=20270630T235959Z');
  });

  it('honors a future term end when provided', () => {
    const ics = buildIcs(
      [session('s1', 'Monday', 540, ['a'])],
      students,
      undefined,
      '2027-05-28',
      NOW
    );
    expect(ics).toContain('UNTIL=20270528T235959Z');
  });

  it('escapes commas in multi-student summaries', () => {
    const ics = buildIcs([session('s1', 'Monday', 540, ['a', 'b'])], students, undefined, undefined, NOW);
    expect(ics).toContain('SUMMARY:OT: Ana B.\\, Ben C.');
  });

  it('emits one VEVENT per session with a unique UID', () => {
    const ics = buildIcs(
      [session('s1', 'Monday', 540, ['a']), session('s2', 'Tuesday', 600, ['b'])],
      students,
      undefined,
      undefined,
      NOW
    );
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
  });
});

describe('buildProviderIcs', () => {
  function provider(name: string, sessions: ProviderSchedule['sessions']): ProviderSchedule {
    return { providerName: name, sheetName: name, sessions };
  }

  const roster = [student('Ana', 'Brown', 'a'), student('Ben', 'Cole', 'b')];

  it('includes only roster students, shown by their roster name', () => {
    const ps = provider('Speech - Jane Doe', [
      // "Zed Q." is NOT on Amanda's roster — must be dropped from the session.
      { day: 'Monday', startTime: 540, endTime: 570, studentNames: ['Ana B.', 'Zed Q.'], rawText: 'x' },
    ]);
    const ics = buildProviderIcs(ps, roster, undefined, undefined, NOW)!;
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Ana B.');
    expect(ics).not.toContain('Zed');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261012T090000');
    expect(ics).toContain('DESCRIPTION:Speech - Jane Doe');
  });

  it('returns null when none of the provider\'s students are on the roster', () => {
    const ps = provider('Outsider', [
      { day: 'Monday', startTime: 540, endTime: 570, studentNames: ['Zed Q.', 'Quincy X.'], rawText: 'x' },
    ]);
    expect(buildProviderIcs(ps, roster, undefined, undefined, NOW)).toBeNull();
  });

  it('returns null when the provider has no usable sessions', () => {
    const ps = provider('Empty', [
      { day: 'Monday', startTime: 540, endTime: 570, studentNames: [], rawText: '' },
    ]);
    expect(buildProviderIcs(ps, roster, undefined, undefined, NOW)).toBeNull();
  });
});

describe('README', () => {
  it('states the real recurrence window and lists the calendar files', () => {
    const { start, end } = recurrenceWindow(undefined, undefined, NOW); // NOW = Wed Oct 7 2026
    const readme = buildReadme(
      [['Amanda-Huang.ics', 'your schedule — Amanda Huang'], ['Speech.ics', 'Speech']],
      NOW,
      start,
      end
    );
    expect(readme).toContain('Amanda-Huang.ics');
    expect(readme).toContain('Speech.ics');
    expect(readme).toContain('October 12, 2026'); // first Monday on/after export
    expect(readme).toContain('June 30, 2027'); // default school-year end
    expect(readme).toMatch(/delete the (old|previous)/i);
    expect(readme).toMatch(/Import & export/);
  });
});
