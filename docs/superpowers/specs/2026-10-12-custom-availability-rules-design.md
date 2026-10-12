# Custom per-student availability rules — design

Date: 2026-10-12
Status: approved (design), pending implementation plan

## Purpose

Let the provider (Amanda) pin per-student availability constraints that the app
honors when building a schedule and flags when a manual placement breaks them.
The constraints are her own knowledge, not present in any uploaded file, so they
must persist on-device **separately from the imported sheet data** and survive a
re-import of the roster or master schedule without being lost.

Two constraint shapes, combinable on one student:

1. **Allow-only** — "I can see this student *only* at these times."
2. **Block** — "I can *not* see this student at these times."

Success: Amanda paints a student's allowed/blocked 30-minute cells in a small
editor; auto-generate never puts that student in a forbidden cell; a manual drop
into a forbidden cell lights the card red and lists the reason; and the rules are
still there after she re-imports updated sheets.

## Scope decisions (agreed)

- Granularity: **30-minute grid cells** (day + slot start), painted in an editor
  that reuses the app's weekly-grid look.
- Generator behavior: **respect + flag** — the auto-scheduler treats forbidden
  cells as unavailable, and the validator flags any violation after the fact.
- Severity: **always `error`** for custom rules (no per-rule severity for now).
  A forbidden cell is a hard constraint in the scheduler and an `error` in the
  validator.
- "List all issues per cell" is **already implemented** — each card aggregates
  every `ValidationError` scoped to it into its hover tooltip and rings the
  most-severe color. Custom-rule errors join that aggregation with no extra UI.

## Data model

One record per student, keyed by OSIS (the stable identifier that survives
re-import). Both layers live in one record, so "combine both" is just two
brushes on one grid.

```ts
// day → painted 30-minute cell start times (minutes from midnight), sorted.
type CellSet = Partial<Record<DayOfWeek, number[]>>;

interface StudentRules {
  studentId: string;   // OSIS number
  allow?: CellSet;     // if non-empty: student may be seen ONLY in these cells
  block?: CellSet;     // student is never seen in these cells
  note?: string;       // optional free text, shown in the editor
  enabled: boolean;    // turn the rules off without deleting them
}
```

### Evaluation

For a session belonging to the student, take each 30-minute cell the session
occupies (`day`, `startTime`, stepping by `slotDuration` to `endTime`). A cell
`C` is a **violation** when, for an `enabled` record:

- `C` is in `block`, **or**
- `allow` is non-empty **and** `C` is not in `allow`.

Notes:

- When `allow` is non-empty it restricts the student to those cells; cells that
  are neither allowed nor blocked are implicitly forbidden. `block` is then a
  redundant-but-harmless subset.
- When `allow` is empty, only `block` cells are forbidden; everything else is
  fine.
- `enabled: false` disables all evaluation for that student.
- A record with empty `allow` and empty `block` is a no-op (treated as absent).

The evaluation lives in one pure function so the scheduler, the validator, and
the tests share identical semantics:

```ts
// src/scheduling/availability.ts
function cellForbidden(
  rules: StudentRules | undefined,
  day: DayOfWeek,
  slotStart: number
): boolean;

function sessionViolatesRules(
  rules: StudentRules | undefined,
  session: { day: DayOfWeek; startTime: number; endTime: number },
  slotDuration: number
): boolean;
```

## Persistence

- New IndexedDB key `custom-rules` in the existing key-value store
  (`src/store/persistence.ts` already stores arbitrary keys in the `app-state`
  object store). The value is `StudentRules[]`.
- This key is written and read **independently** of the `app-state` key that
  holds students/sessions/config. Re-importing sheets rewrites `app-state` but
  never touches `custom-rules`. Rules re-attach to students by OSIS on the next
  load.
- Rules whose OSIS is not in the current roster are **kept dormant**, not
  deleted, so a re-import that temporarily drops or renames a student does not
  lose their rules. Dormant rules simply never match a session.
- Save is debounced like the main state, under its own key.

## Store (Zustand)

Add to `AppState` (`src/store/useAppStore.ts`):

- `customRules: StudentRules[]`
- `setStudentRules(studentId: string, rules: Omit<StudentRules, 'studentId'>): void`
  — upsert the record for that OSIS, then persist the `custom-rules` key.
- `removeStudentRules(studentId: string): void`
- `loadFromStorage` also loads the `custom-rules` key and sanitizes each record
  (same defensive pattern as `sanitizeStudent`/`sanitizeSession`), so an older
  or malformed record cannot crash rendering.

`customRules` is **not** merged into the `app-state` payload; it saves and loads
on its own key.

## Scheduler

Thread rules through the two entry points:

- `generateSchedule(students, conflicts, config, rules: StudentRules[] = [])`
- Build a `Map<studentId, StudentRules>` once at the top.

In `src/scheduling/constraints.ts` add a hard constraint:

```ts
function checkStudentAvailability(
  studentId: string,
  slot: TimeSlot,
  rules: StudentRules | undefined,
  config: AppConfig
): ConstraintResult;
```

It fails when the slot's cell(s) are forbidden for that student. `algorithm.ts`
calls it alongside the other hard constraints (around line 240 for groups and
line 340 for singles) so a forbidden cell is never chosen. Because custom rules
are always `error`, there is no penalty path — forbidden cells are hard-excluded,
not merely down-weighted.

`ModeSelector` (and anywhere else that calls `generateSchedule`) passes
`customRules` from the store.

## Validator

- Extend `validateSchedule(sessions, students, conflicts, config, rules: StudentRules[] = [])`.
- Add `'custom_availability'` to the `ValidationError['type']` union in
  `src/types/index.ts`.
- For each session whose student has an `enabled` matching record and at least
  one forbidden cell, push one `ValidationError`:
  - `type: 'custom_availability'`, `severity: 'error'`
  - `sessionId: session.id`, `studentId: <OSIS>` so it rings exactly that card
  - `message`: human text naming the reason, e.g.
    `"<Name> is only available at set times — this slot isn't one of them"` for an
    allow-only miss, or `"<Name> is blocked at this time"` for a block hit.
- `ScheduleView` already recomputes validation on mount and on every change
  (`src/components/schedule/ScheduleView.tsx:101`); pass `customRules` into that
  call and add it to the effect's dependency list so edits re-validate live.

Per-cell aggregation is unchanged: `errorAppliesToCard` already routes the new
error to the right `StudentCard`, which lists it in the tooltip with any other
issues and rings red.

## Editor UI

- New component `src/components/rules/StudentRulesEditor.tsx`, shown as a modal.
- Opened from the roster: a small button/icon on each student row in
  `StudentList` / `MandateProgress`, plus a badge on rows that already have an
  `enabled`, non-empty record.
- The modal renders a mini weekly grid: columns = `config.activeDays`, rows =
  the config's time slots (`generateTimeSlots`). Each cell shows one of three
  states: neutral, **allow** (green), **block** (red).
- Brushes: Allow / Block / Erase. Click or drag-paint to set cells. A cell is
  at most one of allow/block.
- Controls: an `enabled` toggle, an optional note field, Save and Cancel.
- Save calls `setStudentRules`; the grid and roster badge update from the store.

No global rules-overview screen in this version (YAGNI); per-student editor plus
the roster badge is enough.

## Testing

- `availability` pure function: block hit; allow-only miss; allowed cell passes;
  combined allow+block; empty record is a no-op; `enabled: false` disables;
  multi-cell session where only one cell is forbidden.
- Persistence: a record keyed by OSIS survives a simulated re-import (replace the
  `app-state` students while leaving `custom-rules` intact → rule still matches).
- Scheduler: `generateSchedule` never places a student in a forbidden cell;
  with an impossible allow-only set the session is left unplaced (and surfaces as
  an unmet mandate), not forced into a forbidden cell.
- Validator: a manual placement in a forbidden cell yields one
  `custom_availability` error scoped to the right `sessionId`/`studentId`;
  an allowed placement yields none.

(Per the project's testing notes, exercise these functions directly with
constructed data — jsdom can't drive the upload/editor UI end to end.)

## Files touched

- `src/types/index.ts` — `StudentRules`, `CellSet`; extend `ValidationError['type']`.
- `src/scheduling/availability.ts` — new; pure evaluation functions.
- `src/scheduling/constraints.ts` — `checkStudentAvailability`.
- `src/scheduling/algorithm.ts` — thread `rules`; call the new constraint.
- `src/scheduling/validator.ts` — thread `rules`; emit `custom_availability`.
- `src/store/useAppStore.ts` — `customRules` slice + actions + load/sanitize.
- `src/store/persistence.ts` — reuse; `custom-rules` key (no schema change).
- `src/components/rules/StudentRulesEditor.tsx` — new editor modal.
- `src/components/roster/*` (`StudentList` / `MandateProgress`) — open button + badge.
- `src/components/schedule/ScheduleView.tsx` — pass `customRules` to validation.
- `src/components/upload/ModeSelector.tsx` — pass `customRules` to `generateSchedule`.
- Tests under `src/__tests__/`.
```
