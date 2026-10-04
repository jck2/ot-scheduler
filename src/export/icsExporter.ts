import type { DayOfWeek, ScheduledSession, Student } from '@/types';

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

function utcStampNow(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
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

export function buildIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string,
  now: Date = new Date()
): string {
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));
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
  const dtstamp = utcStampNow();

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ot-scheduler//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
    ...VTIMEZONE,
  ];

  sessions.forEach((session, i) => {
    const names = session.studentIds
      .map((id) => {
        const s = studentMap.get(id);
        return s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id;
      })
      .join(', ');

    const eventDate = firstDateForDay(session.day, anchor);
    const startHour = Math.floor(session.startTime / 60);
    const startMinute = session.startTime % 60;
    const endHour = Math.floor(session.endTime / 60);
    const endMinute = session.endTime % 60;

    const uid = `${dtstamp}-${i}-${session.id || Math.random().toString(36).slice(2)}@ot-scheduler`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TZID}:${localStamp(eventDate, startHour, startMinute)}`,
      `DTEND;TZID=${TZID}:${localStamp(eventDate, endHour, endMinute)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${dayToIcsDay(session.day)};UNTIL=${until}`,
      fold(`SUMMARY:OT: ${escapeText(names)}`),
      fold(`DESCRIPTION:Students: ${escapeText(names)}`),
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function exportScheduleIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string
): void {
  const ics = buildIcs(sessions, students, termStart, termEnd);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ot-schedule.ics';
  a.click();
  URL.revokeObjectURL(url);
}
