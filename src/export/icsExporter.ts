import { zipSync, strToU8 } from 'fflate';
import { buildNameIndex, matchExternalName } from '@/parsing/overlayMatcher';
import { isExcludedProvider } from '@/utils/constants';
import type {
  AppConfig,
  DayOfWeek,
  ProviderSchedule,
  ScheduledSession,
  Student,
} from '@/types';

// Hand-rolled RFC 5545 generator. We don't use the `ics` library here because it
// can't emit a VTIMEZONE block or pin events to a named timezone, and it hard-codes
// METHOD:PUBLISH — both of which break Google Calendar's import for this use case.
// Every session is pinned to America/New_York (Eastern) so it lands at the right
// wall-clock time in the provider's calendar regardless of the account timezone,
// and stays correct across the daylight-saving change mid-school-year.

const TZID = 'America/New_York';

const DAY_NUM: Record<DayOfWeek, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5,
};

function dayToIcsDay(day: DayOfWeek): string {
  const map: Record<DayOfWeek, string> = {
    Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR',
  };
  return map[day];
}

// Parse "YYYY-MM-DD" (from <input type="date">) as a LOCAL date, so the weekday and
// calendar day don't shift under UTC parsing in negative-offset timezones.
function parseLocalDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The default recurrence anchor Monday. Exporting on a WEEKDAY (Mon–Fri) backdates to
// THIS week's Monday, so a mid-week export already covers the days earlier in the
// current week. Exporting on a WEEKEND (Sat/Sun) anchors to the UPCOMING Monday, since
// the current school week is over.
function anchorMonday(from: Date): Date {
  const day = from.getDay(); // 0 = Sun, 1 = Mon, … 6 = Sat
  const d = atMidnight(from);
  if (day === 6) d.setDate(d.getDate() + 2); // Saturday → next Monday
  else if (day === 0) d.setDate(d.getDate() + 1); // Sunday → next Monday
  else d.setDate(d.getDate() - (day - 1)); // Mon–Fri → this week's Monday
  return d;
}

// End of the school year that contains `anchor`: June 30 of the spring. From August
// onward the year rolls to the next calendar year (fall term → the following June).
function schoolYearEnd(anchor: Date): Date {
  const year = anchor.getMonth() >= 7 ? anchor.getFullYear() + 1 : anchor.getFullYear();
  return new Date(year, 5, 30);
}

// First occurrence of `day` on or after `after`.
function firstDateForDay(day: DayOfWeek, after: Date): Date {
  const diff = (DAY_NUM[day] - after.getDay() + 7) % 7;
  const date = new Date(after);
  date.setDate(date.getDate() + diff);
  return date;
}

// Escape a value for an ICS TEXT field (SUMMARY/DESCRIPTION). Student lists contain
// commas, which are RFC-reserved and must be backslash-escaped.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold content lines longer than 75 octets per RFC 5545 (continuation = CRLF + space).
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  parts.push(' ' + rest);
  return parts.join('\r\n');
}

function localStamp(d: Date, hour: number, minute: number): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hour)}${pad(minute)}00`;
}

function utcStampNow(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

// Standard America/New_York VTIMEZONE (US DST rules since 2007: 2nd Sun Mar → 1st Sun Nov).
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

// A single weekly recurring entry, timezone- and recurrence-agnostic.
interface IcsEvent {
  day: DayOfWeek;
  startTime: number; // minutes from midnight
  endTime: number; // minutes from midnight
  summary: string;
  description: string;
}

// The date window the recurrence spans, given the (optional) configured term dates
// and the export date. Shared by the calendar generator and the README so they can't
// disagree. The anchor is the Monday on/after export by default; a configured term
// start/end is honored only when still in the future (so stale past dates are ignored).
export function recurrenceWindow(
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): { start: Date; end: Date } {
  const today = atMidnight(now);
  const parsedStart = parseLocalDate(termStart);
  const start = parsedStart && parsedStart >= today ? parsedStart : anchorMonday(today);
  const parsedEnd = parseLocalDate(termEnd);
  const end = parsedEnd && parsedEnd > start ? parsedEnd : schoolYearEnd(start);
  return { start, end };
}

// Build a complete VCALENDAR string from generic weekly events. Shared by the
// provider's own schedule and every other provider's schedule.
export function buildCalendar(
  events: IcsEvent[],
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string {
  const { start: anchor, end: endDate } = recurrenceWindow(termStart, termEnd, now);

  // With a TZID DTSTART, RFC 5545 requires UNTIL in UTC. Sessions are daytime
  // (Eastern is behind UTC), so a same-date 23:59:59Z bound includes the final day's
  // events and stops the series after it.
  const until =
    `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T235959Z`;
  const dtstamp = utcStampNow(now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ot-scheduler//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
    ...VTIMEZONE,
  ];

  events.forEach((ev, i) => {
    const eventDate = firstDateForDay(ev.day, anchor);
    const startHour = Math.floor(ev.startTime / 60);
    const startMinute = ev.startTime % 60;
    const endHour = Math.floor(ev.endTime / 60);
    const endMinute = ev.endTime % 60;

    const uid = `${dtstamp}-${i}-${Math.random().toString(36).slice(2)}@ot-scheduler`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TZID}:${localStamp(eventDate, startHour, startMinute)}`,
      `DTEND;TZID=${TZID}:${localStamp(eventDate, endHour, endMinute)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${dayToIcsDay(ev.day)};UNTIL=${until}`,
      fold(`SUMMARY:${escapeText(ev.summary)}`),
      fold(`DESCRIPTION:${escapeText(ev.description)}`),
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// A provider's go-by first name for the event title. Strips a leading service/category
// prefix ("Speech - Jane Doe" → "Jane Doe", "OT- Christina" → "Christina", with or
// without spaces around the dash), then takes the first word.
function providerFirstName(name: string): string {
  const stripped = name.replace(/^[A-Za-z]+\s*[-–—]\s*/, '').trim();
  return stripped.split(/\s+/)[0] || name;
}

// Display names for a set of roster students: first name only, with a last initial
// added ONLY for first names shared by more than one roster student (so "Asa" stays
// unambiguous as "Asa D." / "Asa P."). Keeps titles short for phone calendars.
function shortStudentNames(ids: string[], students: Student[], studentMap: Map<string, Student>): string {
  const firstNameCounts = new Map<string, number>();
  for (const s of students) {
    const key = s.firstName.toLowerCase().trim();
    firstNameCounts.set(key, (firstNameCounts.get(key) ?? 0) + 1);
  }
  return ids
    .map((id) => {
      const s = studentMap.get(id);
      if (!s) return id;
      const shared = (firstNameCounts.get(s.firstName.toLowerCase().trim()) ?? 0) > 1;
      return shared ? `${s.firstName} ${s.lastName.charAt(0)}.` : s.firstName;
    })
    .join(', ');
}

function studentNames(session: ScheduledSession, studentMap: Map<string, Student>): string {
  return session.studentIds
    .map((id) => {
      const s = studentMap.get(id);
      return s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id;
    })
    .join(', ');
}

// Events for the provider's own schedule (the one being built in the app).
function ownEvents(sessions: ScheduledSession[], students: Student[]): IcsEvent[] {
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));
  return sessions.map((session) => {
    const names = studentNames(session, studentMap);
    return {
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
      summary: `OT: ${names}`,
      description: `Students: ${names}`,
    };
  });
}

// The provider's own schedule as a calendar.
export function buildIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string {
  return buildCalendar(ownEvents(sessions, students), termStart, termEnd, now);
}

// Events for another provider's schedule, parsed from the master workbook. Only the
// students who are on the user's roster are included — every provider sees many
// students, but the user only cares about her own. External names are matched to
// roster students with the same overlay matcher the grid uses, and shown by their
// roster first name (plus last initial when the first name is shared). Sessions with
// no roster student are dropped, so the result can be empty.
function providerEvents(schedule: ProviderSchedule, students: Student[]): IcsEvent[] {
  const nameIndex = buildNameIndex(students);
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));

  const events: IcsEvent[] = [];
  for (const ext of schedule.sessions) {
    const matchedIds = new Set<string>();
    for (const rawName of ext.studentNames) {
      for (const id of matchExternalName(rawName, nameIndex)) matchedIds.add(id);
    }
    if (matchedIds.size === 0) continue; // no roster students in this session → skip

    const names = shortStudentNames([...matchedIds], students, studentMap);

    events.push({
      day: ext.day,
      startTime: ext.startTime,
      endTime: ext.endTime,
      summary: `${providerFirstName(schedule.providerName)}: ${names}`,
      description: `${schedule.providerName}\n${names}`,
    });
  }
  return events;
}

// Another provider's schedule as a calendar. Returns null when none of this
// provider's sessions involve a roster student, so that provider gets no file.
export function buildProviderIcs(
  schedule: ProviderSchedule,
  students: Student[],
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string | null {
  const events = providerEvents(schedule, students);
  if (events.length === 0) return null; // provider pulls none of her students → no file
  return buildCalendar(events, termStart, termEnd, now);
}

// Turn a provider/sheet name into a safe, unique .ics filename within the zip.
function uniqueFileName(base: string, used: Set<string>): string {
  let name = base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'schedule';
  let candidate = `${name}.ics`;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${name}-${n++}.ics`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportScheduleIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string
): void {
  const ics = buildIcs(sessions, students, termStart, termEnd);
  triggerDownload(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'ot-schedule.ics');
}

function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// Plain-text setup guide bundled in the zip. Human-facing, so it's written in normal
// prose (not the terse style used in chat). `calendarFiles` is [filename, label] pairs;
// `combinedFile` is the all-in-one file's name, when the zip has one.
export function buildReadme(
  calendarFiles: [string, string][],
  now: Date,
  start: Date,
  end: Date,
  combinedFile?: string
): string {
  const fileList = calendarFiles.map(([file, label]) => `  - ${file}  (${label})`).join('\n');
  const combinedSection = combinedFile
    ? `
Plus one ALL-IN-ONE file with every session above in a single calendar:
  - ${combinedFile}

Pick ONE way to import, not both, or every session will show up twice:
  A) The separate files, one calendar per person. You can show or hide each
     person on their own.
  B) Only ${combinedFile}, everything in one calendar. Quicker to set up, and
     there's just one calendar to delete when you re-export.
In the all-in-one file, your own sessions start with "OT:" and each other
provider's sessions start with their first name (e.g. "Sonja: Ana").
`
    : '';
  return `OT SCHEDULE — CALENDAR FILES
Exported ${longDate(now)}

WHAT'S IN THIS ZIP
------------------
One calendar file (.ics) per person:
${fileList}
${combinedSection}
Each file holds weekly sessions as recurring events, in Eastern time
(America/New_York). They stay at the correct clock time even after the
November daylight-saving change.

HOW THE DATES WORK  (please read)
---------------------------------
The events recur WEEKLY. If you export on a weekday, the first week starts on the
Monday of that same week, so any sessions earlier in the current week are included.
If you export on a weekend, it starts on the upcoming Monday. For this export that
means:

  First week:  ${longDate(start)}
  Repeats weekly through:  ${longDate(end)}

The start is tied to WHEN YOU EXPORTED, not to any fixed term date. If you
export again in a later week, the new events will begin from that later week.
So if you re-export, delete the previous import first (see below) or you'll end
up with the schedule in two places.

IMPORT INTO GOOGLE CALENDAR
---------------------------
Do this on a computer (the phone app can't import files).

1. (Recommended) Make a separate calendar for each file so you can show, hide,
   or delete each one on its own:
   Google Calendar > left sidebar > "Other calendars" > "+" > "Create new
   calendar". Name it (e.g. the person's name) and click "Create calendar".

2. Import a file:
   Settings (gear icon) > "Import & export" > "Import".
   Choose one .ics file, then under "Add to calendar" pick the calendar you made
   for it, then click "Import". Repeat for each .ics file (one at a time). If you
   chose the all-in-one file, there's only one file to import.

BEFORE YOU IMPORT A NEW VERSION — DELETE THE OLD ONE
----------------------------------------------------
Importing does NOT replace what's already there; it ADDS events. If you imported
an earlier version, remove it first so sessions don't show up twice:

  - If you imported into a SEPARATE calendar (recommended): just delete that
    whole calendar. Settings > click the calendar's name under "Settings for my
    calendars" > scroll down > "Delete". Then import the new file into a fresh
    calendar.
  - If you imported into your MAIN calendar: the events are mixed in with
    everything else and have to be deleted one by one. This is why a separate
    calendar per file is strongly recommended.

A NOTE ON CALENDAR NAMES
------------------------
Importing a .ics file does not create a calendar by itself — Google adds the
events to whichever calendar you pick during import. The file names here are
just labels; they don't set the calendar name. Create and name the calendars
yourself in step 1.
`;
}

export const COMBINED_FILE_BASE = 'All-Schedules';

// The zip's contents: one .ics per calendar (the provider's own schedule first, then
// one for each other provider in the master workbook with ≥1 roster student), an
// all-in-one .ics holding every one of those events (only when there are 2+
// calendars — with just one it would duplicate that file), and a README.
export function buildScheduleZipFiles(
  sessions: ScheduledSession[],
  students: Student[],
  providerSchedules: ProviderSchedule[],
  amandaSheetName: string | null,
  config: AppConfig,
  now: Date = new Date()
): Record<string, Uint8Array> {
  const { termStartDate: termStart, termEndDate: termEnd } = config;
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const calendarFiles: [string, string][] = [];
  const allEvents: IcsEvent[] = [];

  // The user's own schedule.
  const own = ownEvents(sessions, students);
  const ownLabel = config.providerName || 'My Schedule';
  const ownName = uniqueFileName(ownLabel, used);
  files[ownName] = strToU8(buildCalendar(own, termStart, termEnd, now));
  calendarFiles.push([ownName, `your schedule — ${ownLabel}`]);
  allEvents.push(...own);

  // Every other provider from the master workbook.
  for (const ps of providerSchedules) {
    if (amandaSheetName && ps.sheetName === amandaSheetName) continue;
    if (isExcludedProvider(ps.sheetName, ps.providerName)) continue;
    const events = providerEvents(ps, students);
    if (events.length === 0) continue; // pulls none of her students → no file
    const name = uniqueFileName(ps.providerName || ps.sheetName, used);
    files[name] = strToU8(buildCalendar(events, termStart, termEnd, now));
    calendarFiles.push([name, ps.providerName || ps.sheetName]);
    allEvents.push(...events);
  }

  let combinedName: string | undefined;
  if (calendarFiles.length > 1) {
    combinedName = uniqueFileName(COMBINED_FILE_BASE, used);
    files[combinedName] = strToU8(buildCalendar(allEvents, termStart, termEnd, now));
  }

  const { start, end } = recurrenceWindow(termStart, termEnd, now);
  files['READ ME FIRST.txt'] = strToU8(buildReadme(calendarFiles, now, start, end, combinedName));
  return files;
}

// Download the zip built by buildScheduleZipFiles.
export function exportAllSchedulesZip(
  sessions: ScheduledSession[],
  students: Student[],
  providerSchedules: ProviderSchedule[],
  amandaSheetName: string | null,
  config: AppConfig
): void {
  const files = buildScheduleZipFiles(sessions, students, providerSchedules, amandaSheetName, config);
  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer-backed view so Blob gets a clean buffer.
  triggerDownload(new Blob([zipped.slice()], { type: 'application/zip' }), 'schedules.zip');
}
