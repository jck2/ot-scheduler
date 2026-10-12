import type { CellSet, DayOfWeek, StudentRules } from '@/types';

/**
 * Evaluation of custom per-student availability rules. Single source of truth
 * shared by the scheduler (constraints/algorithm), the validator, and the tests,
 * so all three agree on what "forbidden" means.
 *
 * A rule record has two combinable layers (see StudentRules):
 *   - allow: if non-empty, the student may be seen ONLY in these cells.
 *   - block: the student is never seen in these cells.
 * A disabled record, or one with no cells, is a no-op.
 */

function cellSetHas(set: CellSet | undefined, day: DayOfWeek, slotStart: number): boolean {
  const starts = set?.[day];
  return !!starts && starts.includes(slotStart);
}

function cellSetEmpty(set: CellSet | undefined): boolean {
  if (!set) return true;
  return Object.values(set).every((starts) => !starts || starts.length === 0);
}

/** Does this record actually constrain anything? */
export function rulesActive(rules: StudentRules | undefined): boolean {
  if (!rules || !rules.enabled) return false;
  return !cellSetEmpty(rules.allow) || !cellSetEmpty(rules.block);
}

/** Is the single 30-minute cell (day, slotStart) forbidden for this student? */
export function cellForbidden(
  rules: StudentRules | undefined,
  day: DayOfWeek,
  slotStart: number
): boolean {
  if (!rulesActive(rules)) return false;
  const r = rules!;
  if (cellSetHas(r.block, day, slotStart)) return true;
  // allow-only: when non-empty, anything not explicitly allowed is forbidden.
  if (!cellSetEmpty(r.allow) && !cellSetHas(r.allow, day, slotStart)) return true;
  return false;
}

/**
 * Does the session overlap any forbidden cell? Steps across every 30-minute cell
 * the session occupies, so a longer session is caught if any of its cells is
 * forbidden.
 */
export function sessionViolatesRules(
  rules: StudentRules | undefined,
  session: { day: DayOfWeek; startTime: number; endTime: number },
  slotDuration: number
): boolean {
  if (!rulesActive(rules)) return false;
  const step = slotDuration > 0 ? slotDuration : 30;
  for (let t = session.startTime; t < session.endTime; t += step) {
    if (cellForbidden(rules, session.day, t)) return true;
  }
  return false;
}

/** Index a rules array by OSIS for quick lookup during scheduling/validation. */
export function rulesByStudent(rules: StudentRules[]): Map<string, StudentRules> {
  return new Map(rules.map((r) => [r.studentId, r]));
}
