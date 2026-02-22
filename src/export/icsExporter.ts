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

function getNextDateForDay(day: DayOfWeek, after: Date): Date {
  const dayMap: Record<DayOfWeek, number> = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5,
  };
  const target = dayMap[day];
  const current = after.getDay();
  const diff = (target - current + 7) % 7;
  const date = new Date(after);
  date.setDate(date.getDate() + (diff === 0 ? 7 : diff));
  return date;
}

export function exportScheduleIcs(
  sessions: ScheduledSession[],
  students: Student[],
  termStart?: string,
  termEnd?: string
): void {
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));
  const startDate = termStart ? new Date(termStart) : new Date();
  const endDate = termEnd ? new Date(termEnd) : null;

  const events: EventAttributes[] = [];

  for (const session of sessions) {
    const names = session.studentIds
      .map((id) => {
        const s = studentMap.get(id);
        return s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id;
      })
      .join(', ');

    const typeLabel =
      session.type === 'individual' ? '1:1' :
        session.type === 'pair' ? '1:2' : `Group (${session.studentIds.length})`;

    const eventDate = getNextDateForDay(session.day, startDate);
    const startHour = Math.floor(session.startTime / 60);
    const startMinute = session.startTime % 60;
    const durationMinutes = session.endTime - session.startTime;

    // Build recurrence rule
    const rruleParts = [`FREQ=WEEKLY;BYDAY=${dayToIcsDay(session.day)}`];
    if (endDate) {
      const until = endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      rruleParts.push(`UNTIL=${until}`);
    }

    events.push({
      title: `OT: ${names} (${typeLabel})`,
      description: `OT session - ${typeLabel}\nStudents: ${names}`,
      start: [
        eventDate.getFullYear(),
        eventDate.getMonth() + 1,
        eventDate.getDate(),
        startHour,
        startMinute,
      ],
      duration: { minutes: durationMinutes },
      recurrenceRule: rruleParts.join(';'),
    });
  }

  createEvents(events, (error, value) => {
    if (error) {
      console.error('ICS generation error:', error);
      return;
    }

    const blob = new Blob([value], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ot-schedule.ics';
    a.click();
    URL.revokeObjectURL(url);
  });
}
