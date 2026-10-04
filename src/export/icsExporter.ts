import { zipSync, strToU8 } from 'fflate';
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

// The Monday on or after `from` — the default recurrence anchor, so a freshly
// exported schedule starts this coming week rather than on a stale configured date.
function upcomingMonday(from: Date): Date {
  const diff = (DAY_NUM.Monday - from.getDay() + 7) % 7;
  const d = atMidnight(from);
  d.setDate(d.getDate() + diff);
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

// Build a complete VCALENDAR string from generic weekly events. Shared by the
// provider's own schedule and every other provider's schedule.
export function buildCalendar(
  events: IcsEvent[],
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string {
  const today = atMidnight(now);

  // Anchor the recurrence to this coming Monday by default. Only honor a configured
  // term start when it's still in the future — a stale start date from last year
  // would otherwise push every event into the past (and out of her calendar view).
  const parsedStart = parseLocalDate(termStart);
  const anchor = parsedStart && parsedStart >= today ? parsedStart : upcomingMonday(today);

  // Likewise for the end: honor a configured end only if it's after the anchor;
  // otherwise default to the end of this school year (June 30).
  const parsedEnd = parseLocalDate(termEnd);
  const endDate = parsedEnd && parsedEnd > anchor ? parsedEnd : schoolYearEnd(anchor);

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

function studentNames(session: ScheduledSession, studentMap: Map<string, Student>): string {
  return session.studentIds
    .map((id) => {
      const s = studentMap.get(id);
      return s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id;
    })
    .join(', ');
}

// The provider's own schedule (the one being built in the app).
export function buildIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string {
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));
  const events: IcsEvent[] = sessions.map((session) => {
    const names = studentNames(session, studentMap);
    return {
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
      summary: `OT: ${names}`,
      description: `Students: ${names}`,
    };
  });
  return buildCalendar(events, termStart, termEnd, now);
}

// Another provider's schedule, parsed from the master workbook. Student names are
// raw strings (no OSIS to resolve). Returns null when the provider has no usable
// sessions, so empty calendars are skipped in the zip.
export function buildProviderIcs(
  schedule: ProviderSchedule,
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string | null {
  const events: IcsEvent[] = [];
  for (const ext of schedule.sessions) {
    const names = ext.studentNames.filter((n) => n.trim().length > 0).join(', ');
    const label = names || ext.rawText.trim();
    if (!label) continue;
    events.push({
      day: ext.day,
      startTime: ext.startTime,
      endTime: ext.endTime,
      summary: label,
      description: `${schedule.providerName}${names ? `\n${names}` : ''}`,
    });
  }
  if (events.length === 0) return null;
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

// Export a zip with one .ics per calendar: the provider's own schedule first, then
// one for each other provider found in the master workbook.
export function exportAllSchedulesZip(
  sessions: ScheduledSession[],
  students: Student[],
  providerSchedules: ProviderSchedule[],
  amandaSheetName: string | null,
  config: AppConfig
): void {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();

  // The user's own schedule.
  const ownIcs = buildIcs(sessions, students, config.termStartDate, config.termEndDate);
  const ownName = uniqueFileName(config.providerName || 'My Schedule', used);
  files[ownName] = strToU8(ownIcs);

  // Every other provider from the master workbook.
  for (const ps of providerSchedules) {
    if (amandaSheetName && ps.sheetName === amandaSheetName) continue;
    const ics = buildProviderIcs(ps, config.termStartDate, config.termEndDate);
    if (!ics) continue;
    files[uniqueFileName(ps.providerName || ps.sheetName, used)] = strToU8(ics);
  }

  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer-backed view so Blob gets a clean buffer.
  triggerDownload(new Blob([zipped.slice()], { type: 'application/zip' }), 'schedules.zip');
}
