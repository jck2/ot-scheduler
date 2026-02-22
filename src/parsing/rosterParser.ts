import Papa from 'papaparse';
import type { Student } from '@/types';
import { parseMandate } from './mandateParser';

interface RosterRow {
  'First Name': string;
  'Last Name': string;
  'Grade': string;
  'Class': string;
  'OSIS #': string;
  'Occupational Therapy Mandate': string;
  'Provider': string;
  [key: string]: string;
}

export function parseRosterCSV(csvText: string): Student[] {
  const result = Papa.parse<RosterRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const students: Student[] = [];

  for (const row of result.data) {
    const firstName = (row['First Name'] ?? '').trim();
    const lastName = (row['Last Name'] ?? '').trim();
    const provider = (row['Provider'] ?? '').trim();
    const mandateRaw = (row['Occupational Therapy Mandate'] ?? '').trim();
    const className = (row['Class'] ?? '').trim();
    const gradeStr = (row['Grade'] ?? '').trim();
    const osisRaw = (row['OSIS #'] ?? '').trim();

    // Skip empty rows
    if (!firstName && !lastName) continue;

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
