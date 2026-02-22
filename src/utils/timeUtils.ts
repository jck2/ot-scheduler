import type { DayOfWeek, TimeSlot } from '@/types';

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayH}:${m.toString().padStart(2, '0')}${suffix}`;
}

export function timeToMinutes(timeStr: string): number | null {
  const cleaned = timeStr.trim().toUpperCase();

  // Handle "8:30AM", "8:30 AM", "8:30am"
  const ampmMatch = cleaned.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const period = ampmMatch[3];
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  return null;
}

export function parseTimeRange(text: string): { start: number; end: number } | null {
  const cleaned = text.trim().replace(/\s+/g, '');

  // Handle "8:30-9:00", "8:30AM-9AM", "8-8:30"
  const parts = cleaned.split(/[-–—]/);
  if (parts.length !== 2) return null;

  const start = timeToMinutes(parts[0]);
  const end = timeToMinutes(parts[1]);

  if (start === null || end === null) return null;

  return { start, end };
}

export function parseExcelTime(serial: number): number {
  // Excel serial time: fraction of a day (0.354166... = 8:30 AM)
  const totalMinutes = Math.round(serial * 24 * 60);
  return totalMinutes;
}

export function generateTimeSlots(
  startTime: number,
  endTime: number,
  duration: number,
  days: DayOfWeek[]
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (const day of days) {
    for (let t = startTime; t + duration <= endTime; t += duration) {
      slots.push({ startTime: t, endTime: t + duration, day });
    }
  }
  return slots;
}

export function slotsOverlap(
  s1Start: number, s1End: number,
  s2Start: number, s2End: number
): boolean {
  return s1Start < s2End && s2Start < s1End;
}

export function dayIndex(day: DayOfWeek): number {
  const order: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  return order.indexOf(day);
}
