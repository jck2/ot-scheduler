import Papa from 'papaparse';
import type { Student } from '@/types';
import { parseMandate } from './mandateParser';

// Column order used when the CSV has NO header row (a raw export of the roster
// sheet). The OT source tab has shipped headerless across years, so we fall back
// to reading columns by position: First, Last, Grade, Class, OSIS, Mandate, Provider.
const POSITIONAL_COLS: Record<ColKey, number> = {
  firstName: 0,
  lastName: 1,
  grade: 2,
  className: 3,
  osisNumber: 4,
  mandate: 5,
  provider: 6,
};

type ColKey =
  | 'firstName'
  | 'lastName'
  | 'grade'
  | 'className'
  | 'osisNumber'
  | 'mandate'
  | 'provider';

interface ColumnLayout {
  headerPresent: boolean;
  cols: Record<ColKey, number | undefined>;
}

/**
 * Decide whether row 1 is a header (labels) or already a student, and map each
 * logical column to its index. A header is recognized by "First Name" +
 * "Last Name" cells; the mandate column is matched loosely on /mandate/ so both
 * "Occupational Therapy Mandate" and "Speech Therapy Mandate" resolve.
 */
export function detectColumns(firstRow: string[]): ColumnLayout {
  const norm = firstRow.map((c) => (c ?? '').toString().trim().toLowerCase());
  const looksLikeHeader =
    norm.some((c) => /first\s*name/.test(c)) && norm.some((c) => /last\s*name/.test(c));

  if (!looksLikeHeader) {
    return { headerPresent: false, cols: { ...POSITIONAL_COLS } };
  }

  const find = (re: RegExp): number | undefined => {
    const i = norm.findIndex((c) => re.test(c));
    return i === -1 ? undefined : i;
  };

  return {
    headerPresent: true,
    cols: {
      firstName: find(/first\s*name/),
      lastName: find(/last\s*name/),
      grade: find(/grade/),
      className: find(/^class$/),
      osisNumber: find(/osis/),
      mandate: find(/mandate/),
      provider: find(/provider/),
    },
  };
}

export function parseRosterCSV(csvText: string): Student[] {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  const rows = (parsed.data as unknown as string[][]).filter((r) => Array.isArray(r));
  if (rows.length === 0) return [];

  const layout = detectColumns(rows[0]);
  const dataRows = layout.headerPresent ? rows.slice(1) : rows;

  const students: Student[] = [];

  for (const row of dataRows) {
    const cell = (key: ColKey): string => {
      const idx = layout.cols[key];
      if (idx === undefined) return '';
      return (row[idx] ?? '').toString().trim();
    };

    const firstName = cell('firstName');
    const lastName = cell('lastName');

    // Skip empty rows
    if (!firstName && !lastName) continue;

    const provider = cell('provider');
    const mandateRaw = cell('mandate');
    const className = cell('className');
    const gradeStr = cell('grade');
    const osisRaw = cell('osisNumber');

    // Normalize OSIS: remove spaces, dashes → consistent format
    const osisNumber = normalizeOsis(osisRaw);

    // Parse grade
    const grade = parseGrade(gradeStr);

    const mandateSessions = parseMandate(mandateRaw);

    students.push({
      firstName,
      lastName,
      grade,
      className,
      osisNumber,
      mandateRaw,
      mandateSessions,
      provider,
    });
  }

  return students;
}

export function filterByProvider(students: Student[], providerName: string): Student[] {
  const normalized = providerName.toLowerCase().trim();
  return students.filter((s) => s.provider.toLowerCase().trim() === normalized);
}

export function getProviderNames(students: Student[]): string[] {
  const names = new Set<string>();
  for (const s of students) {
    const p = s.provider.trim();
    if (p) names.add(p);
  }
  return Array.from(names).sort();
}

function normalizeOsis(raw: string): string {
  // Remove all non-digit characters, then format as XXX-XXX-XXX
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }
  return digits;
}

function parseGrade(gradeStr: string): number {
  const lower = gradeStr.toLowerCase();
  if (lower === 'k') return 0;
  if (lower === 'pre-k' || lower === 'prek') return -1;
  const n = parseInt(gradeStr, 10);
  return isNaN(n) ? 0 : n;
}

export function studentDisplayName(s: Student): string {
  return `${s.firstName} ${s.lastName}`;
}

export function studentInitials(s: Student): string {
  const first = s.firstName.charAt(0).toUpperCase();
  const last = s.lastName.charAt(0).toUpperCase();
  return first + last;
}
