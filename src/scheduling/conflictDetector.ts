import type { Conflict, ProviderSchedule, Student } from '@/types';
import { studentDisplayName } from '@/parsing/rosterParser';

/**
 * Scan all other provider sheets to find when Amanda's students have sessions
 * with other providers (Speech, PT, SETSS, Counseling).
 */
export function detectCrossProviderConflicts(
  myStudents: Student[],
  allSchedules: ProviderSchedule[],
  mySheetName: string
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Build a lookup: first name lowercase → student
  const nameIndex = new Map<string, Student[]>();
  for (const s of myStudents) {
    const key = s.firstName.toLowerCase();
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key)!.push(s);
  }

  // Also build full-name index
  const fullNameIndex = new Map<string, Student>();
  for (const s of myStudents) {
    fullNameIndex.set(studentDisplayName(s).toLowerCase(), s);
  }

  // Build initials index: "bl" → [Blake Long, ...]
  const initialsIndex = new Map<string, Student[]>();
  for (const s of myStudents) {
    if (s.firstName.length > 0 && s.lastName.length > 0) {
      const initials = (s.firstName[0] + s.lastName[0]).toLowerCase();
      if (!initialsIndex.has(initials)) initialsIndex.set(initials, []);
      initialsIndex.get(initials)!.push(s);
    }
  }

  for (const schedule of allSchedules) {
    // Skip Amanda's own sheet and all other OT sheets (no student overlap)
    if (schedule.sheetName === mySheetName) continue;
    if (/\bOT\b/i.test(schedule.sheetName)) continue;

    for (const session of schedule.sessions) {
      for (const name of session.studentNames) {
        const student = findStudentByPartialName(name, myStudents, nameIndex, fullNameIndex, initialsIndex);
        if (!student) continue;

        conflicts.push({
          studentId: student.osisNumber,
          studentName: studentDisplayName(student),
          day: session.day,
          startTime: session.startTime,
          endTime: session.endTime,
          otherProvider: schedule.providerName,
          description: `${studentDisplayName(student)} has ${schedule.providerName} session`,
        });
      }
    }
  }

  return conflicts;
}

function findStudentByPartialName(
  name: string,
  students: Student[],
  nameIndex: Map<string, Student[]>,
  fullNameIndex: Map<string, Student>,
  initialsIndex: Map<string, Student[]>
): Student | undefined {
  // Strip parenthetical annotations like "(push in)", "(Magnolia)" before matching
  const lower = name.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();

  if (lower.length < 2) return undefined; // Avoid single-initial false positives

  // Try full name match
  const fullMatch = fullNameIndex.get(lower);
  if (fullMatch) return fullMatch;

  // Extract first word for first-name matching (handles "Ryzen W." → "ryzen")
  const firstWord = lower.split(/\s+/)[0].replace(/\.$/, '');

  // Try first-name match (common in other provider sheets)
  if (firstWord.length >= 2) {
    const firstNameMatches = nameIndex.get(firstWord);
    if (firstNameMatches && firstNameMatches.length === 1) {
      return firstNameMatches[0];
    }
  }

  // Initial-based matching: "TZ" → Tom Z., "P.W." → Poppy W., "BL" → Blake L.
  const stripped = lower.replace(/\./g, '');
  if (stripped.length >= 2 && stripped.length <= 3) {
    const initials = stripped.slice(0, 2);
    const initialMatches = initialsIndex.get(initials);
    if (initialMatches && initialMatches.length === 1) {
      return initialMatches[0];
    }
  }

  // Try partial: roster first name contains the external name (nickname → full name,
  // e.g. "Liz" → "Elizabeth"). Only this direction — the reverse (external contains
  // roster name) causes false positives like "Savannah" matching "Anna".
  if (lower.length >= 3) {
    for (const s of students) {
      const fn = studentDisplayName(s).toLowerCase();
      const firstName = s.firstName.toLowerCase();
      if (firstName.length >= 3 && fn.includes(lower)) {
        return s;
      }
    }
  }

  return undefined;
}
