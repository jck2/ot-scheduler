import { describe, it, expect } from 'vitest';
import { runPreflight, hasBlockingIssues, type PreflightInput } from '@/scheduling/preflight';
import { DEFAULT_CONFIG } from '@/utils/constants';
import { parseMandate } from '@/parsing/mandateParser';
import type { Conflict, ProviderSchedule, Student } from '@/types';

function student(overrides: Partial<Student> = {}): Student {
  const mandateRaw = overrides.mandateRaw ?? '2x30:1';
  return {
    firstName: 'Test',
    lastName: 'Student',
    grade: 4,
    className: 'Elm',
    osisNumber: '123-456-789',
    mandateRaw,
    mandateSessions: parseMandate(mandateRaw),
    provider: 'Amanda Huang',
    ...overrides,
  };
}

function schedule(): ProviderSchedule {
  return { providerName: 'Amanda Huang', sheetName: 'OT- Amanda Huang', sessions: [] };
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  const students = overrides.students ?? [student()];
  return {
    students,
    allStudents: overrides.allStudents ?? students,
    providerSchedules: overrides.providerSchedules ?? [schedule()],
    conflicts: overrides.conflicts ?? [],
    selectedProvider: overrides.selectedProvider ?? 'Amanda Huang',
    amandaSheetName: overrides.amandaSheetName ?? 'OT- Amanda Huang',
    config: overrides.config ?? DEFAULT_CONFIG,
    mode: overrides.mode,
  };
}

describe('runPreflight', () => {
  it('returns no issues for a clean roster', () => {
    expect(runPreflight(input())).toEqual([]);
  });

  it('errors (blocking) when the roster is empty', () => {
    const issues = runPreflight(input({ students: [], allStudents: [] }));
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues[0].detail).toMatch(/header row/i);
  });

  it('errors when students exist but none match the selected provider', () => {
    const issues = runPreflight(
      input({ students: [], allStudents: [student(), student()], selectedProvider: 'Amanda Huang' })
    );
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues[0].title).toMatch(/assigned to/i);
    expect(issues[0].detail).toContain('2');
  });

  it('warns about students with no readable mandate', () => {
    const issues = runPreflight(
      input({ students: [student({ mandateRaw: '', firstName: 'Nomandate' })] })
    );
    const w = issues.find((i) => /no readable mandate/i.test(i.title));
    expect(w?.severity).toBe('warning');
    expect(w?.detail).toContain('Nomandate');
  });

  it('warns about missing and duplicate OSIS numbers', () => {
    const students = [
      student({ firstName: 'NoOsis', osisNumber: '' }),
      student({ firstName: 'DupA', osisNumber: '111-111-111' }),
      student({ firstName: 'DupB', osisNumber: '111-111-111' }),
    ];
    const issues = runPreflight(input({ students }));
    expect(issues.some((i) => /missing an OSIS/i.test(i.title))).toBe(true);
    expect(issues.some((i) => /more than one student/i.test(i.title))).toBe(true);
    // warnings only — not blocking
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('warns when no schedules were parsed from the XLSX', () => {
    const issues = runPreflight(input({ providerSchedules: [] }));
    expect(issues.some((i) => /No provider schedules/i.test(i.title))).toBe(true);
  });

  it('warns the own sheet is missing ONLY when importing, not when generating fresh', () => {
    const otherSheet: ProviderSchedule = {
      providerName: 'Speech- Someone',
      sheetName: 'Speech- Someone',
      sessions: [],
    };
    const base = {
      providerSchedules: [otherSheet],
      selectedProvider: 'Amanda Huang',
      amandaSheetName: '',
    };

    const importIssues = runPreflight(input({ ...base, mode: 'import' }));
    expect(importIssues.some((i) => /own schedule sheet wasn't found/i.test(i.title))).toBe(true);

    const freshIssues = runPreflight(input({ ...base, mode: 'fresh' }));
    expect(freshIssues.some((i) => /own schedule sheet wasn't found/i.test(i.title))).toBe(false);
  });

  it('defaults to fresh mode (no own-sheet warning) when mode is omitted', () => {
    const otherSheet: ProviderSchedule = {
      providerName: 'Speech- Someone',
      sheetName: 'Speech- Someone',
      sessions: [],
    };
    const issues = runPreflight(
      input({ providerSchedules: [otherSheet], selectedProvider: 'Amanda Huang', amandaSheetName: '' })
    );
    expect(issues.some((i) => /own schedule sheet wasn't found/i.test(i.title))).toBe(false);
  });

  it('reports a conflicts summary as info', () => {
    const conflicts: Conflict[] = [
      {
        studentId: '123-456-789',
        studentName: 'Test Student',
        day: 'Monday',
        startTime: 540,
        endTime: 570,
        otherProvider: 'Speech',
        description: 'x',
      },
    ];
    const issues = runPreflight(input({ conflicts }));
    const info = issues.find((i) => /conflict/i.test(i.title));
    expect(info?.severity).toBe('info');
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});
