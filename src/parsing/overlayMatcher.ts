import type { Student } from '@/types';

/**
 * Name-matching for the "other providers" overlay: given a raw name/initial token
 * pulled out of another provider's schedule cell, find which of *this* provider's
 * students (if any) it refers to. Kept separate from the component so it can be
 * unit-tested.
 */
export interface NameIndex {
  students: Student[];
  firstNameIndex: Map<string, Student[]>;
  fullNameIndex: Map<string, Student>;
  initialsIndex: Map<string, Student[]>;
}

// Subject / service / placeholder tokens that show up in schedule cells but are
// NOT student names (ELL/ELA groups, "C.G" = Community Gathering, push-in/pull-out
// markers, etc.). These must never resolve to a student — otherwise placeholders
// like "ELL" match a student whose name merely contains those letters
// (e.g. "ell" inside "Ariella").
const NON_STUDENT_TOKENS = new Set([
  'ell', 'ela', 'esl', 'enl', 'math', 'reading', 'writing', 'science', 'ss',
  'cg', 'prep', 'lunch', 'recess', 'arrival', 'dismissal', 'duty', 'hold',
  'pi', 'po', 'rvp', 'push', 'pull', 'group',
]);

export function buildNameIndex(students: Student[]): NameIndex {
  const firstNameIndex = new Map<string, Student[]>();
  const fullNameIndex = new Map<string, Student>();
  const initialsIndex = new Map<string, Student[]>();

  for (const s of students) {
    const firstKey = s.firstName.toLowerCase().trim();
    if (firstKey) {
      if (!firstNameIndex.has(firstKey)) firstNameIndex.set(firstKey, []);
      firstNameIndex.get(firstKey)!.push(s);
    }
    fullNameIndex.set(`${s.firstName} ${s.lastName}`.toLowerCase().trim(), s);
    if (s.firstName.length > 0 && s.lastName.length > 0) {
      const initials = (s.firstName[0] + s.lastName[0]).toLowerCase();
      if (!initialsIndex.has(initials)) initialsIndex.set(initials, []);
      initialsIndex.get(initials)!.push(s);
    }
  }

  return { students, firstNameIndex, fullNameIndex, initialsIndex };
}

export function isNonStudentToken(rawName: string): boolean {
  const alpha = rawName
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z]/g, '');
  return NON_STUDENT_TOKENS.has(alpha);
}

export function matchExternalName(rawName: string, index: NameIndex): string[] {
  const { students, firstNameIndex, fullNameIndex, initialsIndex } = index;

  const lower = rawName.toLowerCase().trim();
  // Replace parentheticals with a space so surrounding words don't merge —
  // e.g. "Aqeela (Magnolia) push in" must stay "aqeela push in".
  const cleaned = lower.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) return [];

  // Reject pure non-student labels ("ELL", "ELA", "C.G" → "cg", …) up front so
  // they can never fall through to the fuzzy branches below.
  const alphaOnly = cleaned.replace(/[^a-z]/g, '');
  if (NON_STUDENT_TOKENS.has(alphaOnly)) return [];

  const ids: string[] = [];

  const fullMatch = fullNameIndex.get(cleaned);
  if (fullMatch) return [fullMatch.osisNumber];

  const firstNameMatch = firstNameIndex.get(cleaned);
  if (firstNameMatch) return firstNameMatch.map((s) => s.osisNumber);

  const firstWord = cleaned.split(/\s+/)[0].replace(/\.$/, '');
  if (firstWord && firstWord.length >= 2) {
    const firstWordMatch = firstNameIndex.get(firstWord);
    if (firstWordMatch) return firstWordMatch.map((s) => s.osisNumber);
  }

  const stripped = cleaned.replace(/\./g, '');
  if (stripped.length >= 2 && stripped.length <= 3) {
    const initials = stripped.slice(0, 2);
    const initialMatch = initialsIndex.get(initials);
    if (initialMatch) return initialMatch.map((s) => s.osisNumber);
  }

  // Nickname / prefix fallback — the token must be the START of a first name
  // ("Alex" → "Alexander"), not merely contained in it ("ell" ⊂ "Ariella").
  if (cleaned.length >= 3) {
    for (const s of students) {
      const fn = s.firstName.toLowerCase();
      if (fn.length >= 3 && fn.startsWith(cleaned)) ids.push(s.osisNumber);
    }
  }

  return ids;
}
