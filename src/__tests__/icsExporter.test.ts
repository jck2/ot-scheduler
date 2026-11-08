import { describe, it, expect } from 'vitest';
import { strFromU8 } from 'fflate';
import {
  buildIcs,
  buildProviderIcs,
  buildReadme,
  buildScheduleZipFiles,
  recurrenceWindow,
} from '@/export/icsExporter';
import { DEFAULT_CONFIG } from '@/utils/constants';
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

  it('backdates the recurrence to this week\'s Monday for a weekday export', () => {
    // NOW = Wed Oct 7 2026 → this week's Monday = Oct 5; a Thursday session → Oct 8.
    const ics = buildIcs([session('s1', 'Thursday', 600, ['a'])], students, undefined, undefined, NOW);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261008T100000');
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
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261005T090000');
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
    // Title: provider FIRST name + student first name (no last initial — "Ana" is
    // the only Ana on the roster). Description keeps the full provider name.
    expect(ics).toContain('SUMMARY:Jane: Ana');
    expect(ics).not.toContain('Zed');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261005T090000');
    expect(ics).toContain('DESCRIPTION:Speech - Jane Doe');
  });

  it('adds a last initial only when two roster students share a first name', () => {
    const roster2 = [student('Asa', 'Demby', 'a'), student('Asa', 'Penrose', 'b')];
    const ps = provider('Sonja Douglas', [
      { day: 'Monday', startTime: 540, endTime: 570, studentNames: ['Asa D.'], rawText: 'x' },
    ]);
    const ics = buildProviderIcs(ps, roster2, undefined, undefined, NOW)!;
    expect(ics).toContain('SUMMARY:Sonja: Asa D.');
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

describe('buildScheduleZipFiles — all-in-one calendar', () => {
  const roster = [student('Ana', 'Brown', 'a'), student('Ben', 'Cole', 'b')];
  const own = [session('s1', 'Monday', 540, ['a']), session('s2', 'Tuesday', 600, ['b'])];
  const sonja: ProviderSchedule = {
    providerName: 'Speech-Sonja Douglas',
    sheetName: 'Speech-Sonja Douglas',
    sessions: [
      { day: 'Wednesday', startTime: 540, endTime: 570, studentNames: ['Ana'], rawText: 'x' },
    ],
  };
  const outsider: ProviderSchedule = {
    providerName: 'PT-Rosa Perez',
    sheetName: 'PT-Rosa Perez',
    sessions: [
      { day: 'Friday', startTime: 540, endTime: 570, studentNames: ['Zed Q.'], rawText: 'x' },
    ],
  };
  const count = (ics: string) => (ics.match(/BEGIN:VEVENT/g) ?? []).length;

  it('adds one file holding every event from the separate calendars', () => {
    const files = buildScheduleZipFiles(own, roster, [sonja, outsider], null, DEFAULT_CONFIG, NOW);
    expect(Object.keys(files).sort()).toEqual(
      ['All-Schedules.ics', 'Amanda-Huang.ics', 'READ ME FIRST.txt', 'Speech-Sonja-Douglas.ics'].sort()
    );
    const combined = strFromU8(files['All-Schedules.ics']);
    expect(count(combined)).toBe(3); // 2 own + 1 Sonja; Rosa has no roster students
    expect(combined).toContain('SUMMARY:OT: Ana B.');
    expect(combined).toContain('SUMMARY:Sonja: Ana');
    expect(combined.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(combined.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
    const uids = [...combined.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(new Set(uids).size).toBe(3);
    const readme = strFromU8(files['READ ME FIRST.txt']);
    expect(readme).toContain('All-Schedules.ics');
    expect(readme).toMatch(/not both/i);
  });

  it('skips the all-in-one file when there is only the user\'s own calendar', () => {
    const files = buildScheduleZipFiles(own, roster, [outsider], null, DEFAULT_CONFIG, NOW);
    expect(Object.keys(files).sort()).toEqual(['Amanda-Huang.ics', 'READ ME FIRST.txt']);
    expect(strFromU8(files['READ ME FIRST.txt'])).not.toContain('ALL-IN-ONE');
  });
});

describe('recurrence anchor — weekday backdates, weekend looks ahead', () => {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const anchor = (now: Date) => iso(recurrenceWindow(undefined, undefined, now).start);

  it('a weekday export backdates to this week\'s Monday', () => {
    expect(anchor(new Date(2026, 9, 5))).toBe('2026-10-05'); // Mon → itself
    expect(anchor(new Date(2026, 9, 7))).toBe('2026-10-05'); // Wed → Mon Oct 5
    expect(anchor(new Date(2026, 9, 9))).toBe('2026-10-05'); // Fri → Mon Oct 5
  });

  it('a weekend export anchors to the upcoming Monday', () => {
    expect(anchor(new Date(2026, 9, 10))).toBe('2026-10-12'); // Sat → Mon Oct 12
    expect(anchor(new Date(2026, 9, 11))).toBe('2026-10-12'); // Sun → Mon Oct 12
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
    expect(readme).toContain('October 5, 2026'); // weekday export → this week's Monday
    expect(readme).toContain('June 30, 2027'); // default school-year end
    expect(readme).toMatch(/delete the (old|previous)/i);
    expect(readme).toMatch(/Import & export/);
  });
});
