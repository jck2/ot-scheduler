import { createEvents, type EventAttributes } from 'ics';
import type { DayOfWeek, ScheduledSession, Student } from '@/types';

function dayToIcsDay(day: DayOfWeek): string {
  const map: Record<DayOfWeek, string> = {
    Monday: 'MO',
    Tuesday: 'TU',
    Wednesday: 'WE',
    Thursday: 'TH',
    Friday: 'FR',
  };
  return map[day];
}

// Parse a "YYYY-MM-DD" (from <input type="date">) as a LOCAL date, so the weekday
// and calendar day don't shift under UTC parsing in negative-offset timezones.
function parseLocalDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// First occurrence of `day` on or after `after`.
function firstDateForDay(day: DayOfWeek, after: Date): Date {
  const dayMap: Record<DayOfWeek, number> = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5,
  };
  const diff = (dayMap[day] - after.getDay() + 7) % 7;
  const date = new Date(after);
  date.setDate(date.getDate() + diff);
  return date;
}

export function exportScheduleIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string
): void {
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));
  const startDate = parseLocalDate(termStart) ?? new Date();
  const endDate = parseLocalDate(termEnd);

  // Floating UNTIL (no "Z") through the end of the last day, matching the floating
  // DTSTART. Mixing a UTC UNTIL with a floating DTSTART is invalid per RFC 5545.
  const until = endDate
    ? `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T235959`
    : null;

  const events: EventAttributes[] = [];

  for (const session of sessions) {
    const names = session.studentIds
      .map((id) => {
        const s = studentMap.get(id);
        return s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id;
      })
      .join(', ');

    const eventDate = firstDateForDay(session.day, startDate);
    const startHour = Math.floor(session.startTime / 60);
    const startMinute = session.startTime % 60;
    const durationMinutes = session.endTime - session.startTime;

    const rruleParts = [`FREQ=WEEKLY;BYDAY=${dayToIcsDay(session.day)}`];
    if (until) rruleParts.push(`UNTIL=${until}`);

    events.push({
      title: `OT: ${names}`,
      description: `Students: ${names}`,
      // Floating local wall-clock time: the session stays at e.g. 9:00 AM every
      // week regardless of daylight-saving changes during the school year.
      start: [
        eventDate.getFullYear(),
        eventDate.getMonth() + 1,
        eventDate.getDate(),
        startHour,
        startMinute,
      ],
      startInputType: 'local',
      startOutputType: 'local',
      duration: { minutes: durationMinutes },
      recurrenceRule: rruleParts.join(';'),
    });
  }

  createEvents(events, (error, value) => {
    if (error || !value) {
      console.error('ICS generation error:', error);
      return;
    }

    const blob = new Blob([value], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ot-schedule.ics';
    a.click();
    URL.revokeObjectURL(url);
  });
}
