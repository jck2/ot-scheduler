# CLAUDE.md

Guidance for working in this repo. Keep it updated as the codebase changes.

## What this app is

A single-page web app that builds a weekly therapy/service schedule for a school
provider (originally an Occupational Therapist, "Amanda Huang"). The user uploads
two files:

1. **Student roster** (`.csv`) — the whole caseload with mandates and assigned provider.
2. **Master schedule** (`.xlsx`) — every provider's weekly schedule, one sheet per
   provider. Used to detect cross-provider conflicts (times a student is already
   pulled by another service) and to overlay other providers' sessions on the grid.

The app auto-detects the target provider (defaults to whoever matches "amanda"),
filters the roster to that provider's students, then either auto-generates a
conflict-free schedule or lets the user build one by hand. Exports to `.xlsx` and
`.ics`.

It's a personal tool — no backend, no auth. All state lives in the browser
(IndexedDB via `idb`). Deployed to GitHub Pages.

## Stack

- **React 19** + **TypeScript** (strict) + **Vite 7**
- **Tailwind v4** (via `@tailwindcss/vite`)
- **Zustand** for state (`src/store/useAppStore.ts`), persisted to IndexedDB
- **papaparse** (CSV), **xlsx** / **xlsx-js-style** (Excel)
- **@dnd-kit** for drag-and-drop scheduling
- **ics** for calendar export
- **Vitest** + **@testing-library/react** (jsdom) for tests
- **vite-plugin-pwa** — installable PWA

## Commands

```bash
npm run dev        # local dev server
npm run build      # tsc -b && vite build (also the CI/deploy build)
npm run preview    # serve the production build
npm test           # vitest run (one-shot)
npm run test:watch # vitest watch
```

Path alias: `@/` → `src/`.

## Architecture / data flow

```
Upload (FileUploadWizard)
  ├─ parseRosterCSV(csv)            src/parsing/rosterParser.ts  → Student[]
  │    └─ parseMandate(str)         src/parsing/mandateParser.ts → MandateSession[]
  ├─ parseXlsx(buffer)             src/parsing/xlsxParser.ts    → ProviderSchedule[]
  ├─ detectCrossProviderConflicts  src/scheduling/conflictDetector.ts → Conflict[]
  └─ resolveInitialsInSession      src/parsing/initialMatcher.ts (maps "AH" → student)
        ↓ (store: useAppStore)
Disambiguation? → ModeSelector → auto: generateSchedule (src/scheduling/algorithm.ts)
        ↓
ScheduleView / WeeklyGrid  (drag-drop edits, provider overlay, validation)
        ↓
Export: src/export/xlsxExporter.ts, icsExporter.ts
```

Key types are in `src/types/index.ts`. Config defaults (school hours, lunch,
penalties) in `src/utils/constants.ts`. Times are **minutes from midnight**
(e.g. 510 = 8:30am) everywhere internally.

**Preflight checks** ([preflight.ts](src/scheduling/preflight.ts)): before building a
schedule, `ModeSelector` runs `runPreflight` and, if anything turns up, shows
`PreflightModal` — a popup listing human-readable `error` (blocking) / `warning` /
`info` issues (no students, provider mismatch, unreadable mandates, missing/duplicate
OSIS, no schedules parsed, conflicts summary). `runPreflight` takes a
`mode: 'fresh' | 'import'`: the "own schedule sheet not found" warning is **import-only**
— when building the first/fresh schedule of the year the provider's own tab is expected
to be empty, so it's not surfaced. `error`s block and show only "Close"; warnings/info
offer "Continue anyway". Importing an existing schedule with no own sheet degrades
gracefully to generating fresh ([ModeSelector.tsx](src/components/upload/ModeSelector.tsx)). `FileUploadWizard` also
throws a clear message at upload if the roster parses to zero students.

The scheduler (`generateSchedule`) is a greedy constraint solver: decompose
mandates into session requests, group compatible ones by class, sort hardest-first,
place each in the lowest-penalty free slot. Hard constraints in
`src/scheduling/constraints.ts`; validation (mandate fulfillment, double-booking,
class-mixing, etc.) in `src/scheduling/validator.ts`.

## File formats — IMPORTANT (this is where uploads break)

The roster CSV comes in two shapes, and **`parseRosterCSV` now handles both**
([rosterParser.ts](src/parsing/rosterParser.ts)):

- **With header** — `First Name, Last Name, Grade, Class, OSIS #,
  <Service> Mandate, Provider` (plus ignored extras like `CAP Updates`,
  `RSA Status`). The mandate column is matched loosely on `/mandate/`, so both
  `Occupational Therapy Mandate` and `Speech Therapy Mandate` resolve.
- **Headerless** — a raw export of the roster sheet: row 1 is already a student.
  `detectColumns` sees no `First Name`/`Last Name` labels and falls back to
  **positional** columns (`First, Last, Grade, Class, OSIS, Mandate, Provider`).

**Confirmed root cause of the original "app didn't work" report:** the source
`roster-original-format.xlsx` has two tabs — **"Speech Therapy" has a header row,
but the "Occupational Therapy" tab does not.** Exporting the OT tab therefore
produced a headerless `roster.csv`. The old parser used `header: true`, consumed the
first student as column names, dropped every row → **0 students, silently** → the app
looked empty. The positional fallback fixes this; the raw OT export now parses.

The `Provider` column drives everything — the roster can contain multiple providers'
students and the app filters to the auto-detected one (matches "amanda", else first).
The `<Service> Mandate` header must contain the word "Mandate".

Roster files are (still) easy to mix up: last year's and this year's are both named
`roster.csv` in sibling folders under `student rosters/`.

Mandate strings look like `2x30:1` (2×/week, 30 min, group size 1), `1x30:group`
(flexible group → `groupSize: Infinity`, `groupFlexible: true`), comma-separated for
multiple mandates (`"1x30:1, 1x30:3"`). Parsed by regex in `mandateParser.ts`.

**Grouping is optional, not required — `:N` is a MAX group size, not a required
session type.** A student needs `Σ frequency` sessions/week total, and *any* of them
may be delivered individually. The `:N` only caps how many sessions may be group
sessions and how large (`:1` = must be individual; `:3` = may be a group of ≤3;
`:group` = flexible, capped at 3 by the scheduler's `MAX_GROUP_SIZE`). So a
`2x30:1, 1x30:3` student validly gets 3 individual sessions; at most 1 may be a group.

**Grouping is inferred from CO-LOCATION, not stored.** Two students in the same
calendar block (same day + start time) are one intended group, even in separate
`ScheduledSession` objects. There is **no `type` field on a session** — individual vs
group is derived from `buildSlotOccupancy` / `slotStudentCount`
([validator.ts](src/scheduling/validator.ts)), the single source of truth used by both
the calendar cards ([StudentCard.tsx](src/components/schedule/StudentCard.tsx) via
[TimeSlotCell.tsx](src/components/schedule/TimeSlotCell.tsx)) and the roster chip, so
they always agree and update live. Dropping a student into an occupied slot **always
groups** them ([ScheduleView.tsx](src/components/schedule/ScheduleView.tsx) `handleDrop`)
— it never silently splits to dodge a rule; the validator explains any problem.

`getStudentSessionSummary` computes totals + grouping; the roster chip
([MandateProgress.tsx](src/components/roster/MandateProgress.tsx)) shows a **Total**
chip (green when the required count is met) and a **Group** chip (neutral, amber when
grouped more than allowed). `getMandateProgress` (per-mandate) is kept only for
drag-drop mandate tagging in `ScheduleView`.

**Validation** (`validateSchedule`) — severities reflect what matters to the provider:
- **error** — cross-provider conflict; a student scheduled twice in one day; provider
  overlap at *different* start times; unmet total; over-scheduled (more sessions than
  the mandate).
- **warning (advisory)** — over the group-session cap; a `:1` student in a group; a
  group larger than a student's `:N`; grouped students in different *named* classes
  (fires only when ≥2 have differing non-blank classes — class data is often missing);
  lunch/extended hours. Same slot / same start time is a group, **not** a
  double-booking.

**Card attribution** — `errorAppliesToCard(e, sessionId, studentId)` decides which
cards an issue rings: the session must be in scope (`sessionId`/`sessionIds`) **and**
the student a subject (`studentId`/`studentIds`, or none = every student in the
session). So a conflict rings only the conflicting card, an over-cap warning only the
grouped cards, and same-day doubles are emitted **once per cell** (each pointing at the
other time). Issues with no session scope (e.g. unmet total) show only in the list.
Cards are **grade-colored** (solid fills, no border), with a **red `ring-[3px]`** for an
error and a lighter **amber `ring-2`** for a warning; the toolbar shows error/warning
counts (hover for the full list) plus `sessions · student-slots`. `validationErrors`
isn't persisted, so `ScheduleView` recomputes it on mount and on every schedule change.

The XLSX parser (`xlsxParser.ts`) is heuristic and tolerant: it scans each sheet for
a header row containing ≥2 day names, finds the time column, reads student
names/initials out of day cells (handling in-cell time ranges, sidebar group
definitions, group references, skip-cells like "LUNCH"/"PREP"). Sheets named
"Provider Info"/"…info" are skipped. Provider = sheet name.

## Gotchas / known issues

- **Data files are gitignored** (`.gitignore` excludes `*.csv`, `*.xlsx`, `Screenshot*`,
  `dist`). The rosters/schedules under `student rosters/` are local-only, not committed.
- **Parsers require a real `ArrayBuffer`.** In the browser `File.arrayBuffer()` is
  fine. In Node scripts/tests, convert with `new Uint8Array(fs.readFileSync(p)).buffer`
  — do NOT pass `buf.buffer` directly (Node pools buffers, so the raw `.buffer` is the
  wrong bytes and `XLSX.read` silently returns an empty `Sheet1`).
- **jsdom can't exercise the upload UI.** `File.text()/arrayBuffer()` never resolve
  and `indexedDB` is undefined under vitest's jsdom, so an end-to-end "render <App/>
  and upload a file" test hangs. Test the parsing/scheduling functions directly with
  bytes read via `fs` instead.
- **Debug `console.log`s are live** in `xlsxParser.ts` (added while chasing the
  provider-overlay bug). Noisy but harmless; strip when convenient. (WeeklyGrid's were
  removed.)
- **Roster Class column is often empty.** The OT export leaves Class blank for most
  students (85/90 in 2026-27), so `StudentList` can only group the few that have one;
  the rest fall into a single "No class listed" bucket. Grouping keys are normalized
  (trim + case-insensitive) so "Elm"/"elm " merge. Real class grouping would need the
  Class column filled, or classes derived from the schedule's "(Magnolia)" annotations.
- **Overlay name matching lives in [overlayMatcher.ts](src/parsing/overlayMatcher.ts)**
  (`buildNameIndex` + `matchExternalName`), used by `WeeklyGrid`. It has a
  `NON_STUDENT_TOKENS` blocklist (ELL, ELA, C.G, prep, push/pull, …) so subject/service
  placeholders don't match, and its nickname fallback matches a first-name **prefix**
  ("Alex"→"Alexander"), never a mid-name substring ("ell" ⊄ "Ariella"). Add new
  placeholder labels to that set. `ModeSelector`'s import resolver is separate and
  stricter (no substring fallback) — leave it unless import misbehaves.
- **`index.html`** references `/vite.svg` for its favicon, which doesn't exist (the PWA
  icons live in `public/`). Cosmetic.
- `groupSize: Infinity` for flexible-group mandates does not survive a JSON round-trip
  (becomes `null`); IndexedDB's structured clone preserves it, so persistence is fine,
  but be careful if you ever `JSON.stringify` sessions/mandates.
- **Loading old persisted data is sanitized** — `loadFromStorage` runs every stored
  student/session through `sanitizeStudent`/`sanitizeSession`
  ([useAppStore.ts](src/store/useAppStore.ts)) so a missing/renamed field from an older
  version can't crash rendering. Saves are debounced 2s, so a reload within ~2s of an
  edit can lose that last change.
- **Exports are name-only** ([xlsxExporter.ts](src/export/xlsxExporter.ts),
  [icsExporter.ts](src/export/icsExporter.ts)): the schedule grid / calendar shows just
  first name + last initial and the day/time. No group/type annotation, no mandate, no
  student-summary sheet (xlsx keeps class-based cell coloring only).

## Deploy

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to
`main`. `vite.config.ts` sets `base: '/ot-scheduler/'`, so the live app is served
under that path. Deployed app == latest `main`.
