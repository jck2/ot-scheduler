import type { Student, InitialMapping } from '@/types';
import { studentDisplayName } from './rosterParser';

/**
 * Known 2-letter initial → student mappings for Amanda's roster.
 * These are hardcoded from the plan since the XLSX uses initials only.
 */
const KNOWN_MAPPINGS: Record<string, string> = {
  HF: 'Hugh Fuccillo',
  RW: 'Ryzen Williams',
  RS: 'Roland Stephenson',
  AM: 'Aaliyah Martinez',
  RR: 'Roger Rush',
  MM: 'Magritte Mittnacht',
  SC: 'Sarah Charles',
  CF: 'Camille Fludd-Briffault',
  LN: 'Luna Norzi',
  AA: 'Arahli Aviles',
  AO: "Aqeela O'Neil",
  SA: 'Stella Albright-Lister',
  BL: 'Blake Lias',
  AB: 'Aden Bernardez',
  ED: 'Emma Dieubon',
  TZ: 'Tom Zubalsky',
  ER: 'Ezekiel Ruta-Smith',
  AC: 'Ava Cicero',
  KF: 'Karter Ferreira',
  KD: 'Kalena Dickens',
  JS: 'Joichi Santise',
};

const THREE_LETTER_MAPPINGS: Record<string, string> = {
  JuS: 'Juniper Sober',
};

// Special case: PV → Anna Poppy Vidal (middle-name initial)
const SPECIAL_MAPPINGS: Record<string, string> = {
  PV: 'Anna Poppy Vidal',
};

// Known ambiguous initials
const AMBIGUOUS_INITIALS: Record<string, string[]> = {
  AP: ['Asa Penrose', 'Alma Prondak', 'Anna Poppy Vidal'],
};

// Known unknown initials (not in Amanda's roster)
const UNKNOWN_INITIALS = new Set(['MF']);

export function matchInitials(
  initials: string[],
  students: Student[],
  coScheduledContext?: Map<string, string[]>
): InitialMapping[] {
  const mappings: InitialMapping[] = [];

  for (const initial of initials) {
    const trimmed = initial.trim().toUpperCase();
    const mapping = matchSingleInitial(trimmed, initial, students, coScheduledContext);
    mappings.push(mapping);
  }

  return mappings;
}

function matchSingleInitial(
  normalizedInitial: string,
  originalInitial: string,
  students: Student[],
  _coScheduledContext?: Map<string, string[]>
): InitialMapping {
  // Check known exact mappings
  if (KNOWN_MAPPINGS[normalizedInitial]) {
    const name = KNOWN_MAPPINGS[normalizedInitial];
    const student = findStudentByName(students, name);
    if (student) {
      return {
        initial: originalInitial,
        studentId: student.osisNumber,
        confidence: 'exact',
      };
    }
  }

  // Check 3-letter mappings
  if (THREE_LETTER_MAPPINGS[originalInitial]) {
    const name = THREE_LETTER_MAPPINGS[originalInitial];
    const student = findStudentByName(students, name);
    if (student) {
      return {
        initial: originalInitial,
        studentId: student.osisNumber,
        confidence: 'exact',
      };
    }
  }

  // Check special mappings
  if (SPECIAL_MAPPINGS[normalizedInitial]) {
    const name = SPECIAL_MAPPINGS[normalizedInitial];
    const student = findStudentByName(students, name);
    if (student) {
      return {
        initial: originalInitial,
        studentId: student.osisNumber,
        confidence: 'exact',
      };
    }
  }

  // Check known ambiguous
  if (AMBIGUOUS_INITIALS[normalizedInitial]) {
    const candidateNames = AMBIGUOUS_INITIALS[normalizedInitial];
    const candidates = candidateNames
      .map((name) => {
        const s = findStudentByName(students, name);
        return s
          ? { studentId: s.osisNumber, name: studentDisplayName(s), className: s.className }
          : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return {
      initial: originalInitial,
      studentId: candidates[0]?.studentId ?? '',
      confidence: 'ambiguous',
      candidates,
    };
  }

  // Check known unknowns
  if (UNKNOWN_INITIALS.has(normalizedInitial)) {
    return {
      initial: originalInitial,
      studentId: '',
      confidence: 'unknown',
    };
  }

  // Try to match by first+last initials against roster
  const matches = students.filter((s) => {
    const fi = s.firstName.charAt(0).toUpperCase();
    const li = s.lastName.charAt(0).toUpperCase();
    return fi + li === normalizedInitial;
  });

  if (matches.length === 1) {
    return {
      initial: originalInitial,
      studentId: matches[0].osisNumber,
      confidence: 'exact',
    };
  }

  if (matches.length > 1) {
    return {
      initial: originalInitial,
      studentId: matches[0].osisNumber,
      confidence: 'ambiguous',
      candidates: matches.map((s) => ({
        studentId: s.osisNumber,
        name: studentDisplayName(s),
        className: s.className,
      })),
    };
  }

  return {
    initial: originalInitial,
    studentId: '',
    confidence: 'unknown',
  };
}

function findStudentByName(students: Student[], fullName: string): Student | undefined {
  const lower = fullName.toLowerCase();
  return students.find(
    (s) => `${s.firstName} ${s.lastName}`.toLowerCase() === lower
  );
}

export function resolveInitialsInSession(
  rawText: string,
  students: Student[]
): InitialMapping[] {
  // Split cell text by comma/space to extract initials
  const parts = rawText
    .split(/[,;&]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 3 && /^[A-Za-z]+$/.test(s));

  return matchInitials(parts, students);
}
