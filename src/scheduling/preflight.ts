import type { AppConfig, Conflict, ProviderSchedule, Student } from '@/types';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  severity: PreflightSeverity;
  title: string;
  detail: string;
}

export interface PreflightInput {
  students: Student[]; // filtered to the selected provider
  allStudents: Student[]; // full roster, all providers
  providerSchedules: ProviderSchedule[];
  conflicts: Conflict[];
  selectedProvider: string;
  amandaSheetName: string;
  config: AppConfig;
  // 'fresh' = building a new schedule (own tab is expected to be empty);
  // 'import' = loading the provider's existing schedule from the XLSX.
  mode?: 'fresh' | 'import';
}

const MAX_NAMES = 8;

function nameList(students: Student[]): string {
  const names = students.map((s) => `${s.firstName} ${s.lastName}`.trim());
  if (names.length <= MAX_NAMES) return names.join(', ');
  return `${names.slice(0, MAX_NAMES).join(', ')}, and ${names.length - MAX_NAMES} more`;
}

/**
 * Inspect the loaded roster + schedules before building a schedule and return
 * human-readable issues. `error` blocks generation (data can't be used);
 * `warning`/`info` are advisory and the user can proceed.
 */
export function runPreflight(input: PreflightInput): PreflightIssue[] {
  const {
    students,
    allStudents,
    providerSchedules,
    conflicts,
    selectedProvider,
    amandaSheetName,
    mode = 'fresh',
  } = input;
  const issues: PreflightIssue[] = [];

  // --- Blocking: no students to schedule ---
  if (students.length === 0) {
    if (allStudents.length > 0) {
      issues.push({
        severity: 'error',
        title: `No students are assigned to "${selectedProvider}"`,
        detail:
          `The roster loaded ${allStudents.length} student(s), but none list ` +
          `"${selectedProvider}" in the Provider column. Check the Provider spelling ` +
          `in the roster, or that you uploaded the right roster.`,
      });
    } else {
      issues.push({
        severity: 'error',
        title: 'No students were found in the roster',
        detail:
          'The roster CSV came back empty. Make sure it has the columns ' +
          'First Name, Last Name, Grade, Class, OSIS #, (Occupational Therapy) Mandate, ' +
          'Provider — either as a header row, or as raw data in that order.',
      });
    }
    return issues; // everything below depends on having students
  }

  // --- Warning: students with no readable mandate ---
  const noMandate = students.filter((s) => s.mandateSessions.length === 0);
  if (noMandate.length > 0) {
    issues.push({
      severity: 'warning',
      title: `${noMandate.length} student(s) have no readable mandate`,
      detail:
        `These students have an empty or unrecognized Mandate value and won't be ` +
        `scheduled: ${nameList(noMandate)}. Mandates should look like "2x30:1" ` +
        `(2 sessions/week, 30 min, group of 1) or "1x30:group".`,
    });
  }

  // --- Warning: students missing an OSIS number (used as the unique id) ---
  const noOsis = students.filter((s) => !s.osisNumber);
  if (noOsis.length > 0) {
    issues.push({
      severity: 'warning',
      title: `${noOsis.length} student(s) are missing an OSIS number`,
      detail:
        `OSIS # is used as each student's unique id. Without it, students can be ` +
        `dropped or merged when scheduling: ${nameList(noOsis)}. Add the OSIS # column.`,
    });
  }

  // --- Warning: duplicate OSIS numbers (collide as the same id) ---
  const byOsis = new Map<string, Student[]>();
  for (const s of students) {
    if (!s.osisNumber) continue;
    if (!byOsis.has(s.osisNumber)) byOsis.set(s.osisNumber, []);
    byOsis.get(s.osisNumber)!.push(s);
  }
  const dupOsis = [...byOsis.values()].filter((g) => g.length > 1);
  if (dupOsis.length > 0) {
    issues.push({
      severity: 'warning',
      title: `${dupOsis.length} OSIS number(s) are used by more than one student`,
      detail:
        `Duplicate OSIS numbers collide into one student when scheduling: ` +
        `${nameList(dupOsis.map((g) => g[0]))}. Give each student a distinct OSIS #.`,
    });
  }

  // --- Warning: no schedules parsed from the XLSX ---
  if (providerSchedules.length === 0) {
    issues.push({
      severity: 'warning',
      title: 'No provider schedules were read from the XLSX',
      detail:
        "No sheet had day-of-week headers (Monday–Friday), so other providers' " +
        'sessions and cross-provider conflicts can\'t be detected. Check the schedule file.',
    });
  }

  // --- Warning: the provider's own schedule sheet wasn't found/usable ---
  // Only relevant when *importing* an existing schedule. When building fresh (e.g.
  // the first schedule of the year) the provider's own tab is expected to be empty,
  // so this is not surfaced. Also only meaningful once some schedules parsed — the
  // empty case is covered above.
  if (mode === 'import' && providerSchedules.length > 0) {
    const providerLower = selectedProvider.toLowerCase().trim();
    const lastName = providerLower.split(/\s+/).pop() ?? providerLower;
    const ownSheetFound = providerSchedules.some((ps) => {
      const name = ps.sheetName.toLowerCase();
      return (
        (!!amandaSheetName && ps.sheetName === amandaSheetName) ||
        name.includes(providerLower) ||
        (lastName.length > 2 && name.includes(lastName))
      );
    });
    if (!ownSheetFound) {
      issues.push({
        severity: 'warning',
        title: "Your own schedule sheet wasn't found in the XLSX",
        detail:
          `No sheet in the schedule file matches "${selectedProvider}" — your tab may be ` +
          `empty or named differently. "Import Existing Schedule" will build a fresh schedule ` +
          `instead; "Generate Fresh Schedule" works either way.`,
      });
    }
  }

  // --- Info: conflicts summary ---
  if (conflicts.length > 0) {
    const affected = new Set(conflicts.map((c) => c.studentId)).size;
    issues.push({
      severity: 'info',
      title: `${conflicts.length} cross-provider conflict(s) detected`,
      detail:
        `${affected} of your student(s) are pulled by another provider during the week. ` +
        `The scheduler will avoid those time slots automatically.`,
    });
  }

  return issues;
}

export function hasBlockingIssues(issues: PreflightIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
