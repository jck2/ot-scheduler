import * as XLSX from 'xlsx-js-style';
import type { DayOfWeek, ScheduledSession, Student } from '@/types';
import { minutesToTime, dayIndex } from '@/utils/timeUtils';

// Class → hex background colors for export
const CLASS_FILL: Record<string, { fgColor: { rgb: string } }> = {
  Magnolia: { fgColor: { rgb: 'DBEAFE' } },   // blue-100
  Elm:      { fgColor: { rgb: 'D1FAE5' } },    // emerald-100
  Honeylocust: { fgColor: { rgb: 'EDE9FE' } }, // violet-100
  Pine:     { fgColor: { rgb: 'FFEDD5' } },     // orange-100
};

export function exportScheduleXlsx(
  sessions: ScheduledSession[],
  students: Student[],
  activeDays: DayOfWeek[]
): void {
  const studentMap = new Map(students.map((s) => [s.osisNumber, s]));
  const sortedDays = [...activeDays].sort((a, b) => dayIndex(a) - dayIndex(b));

  // Build grid data
  // Find time range
  const allTimes = sessions.flatMap((s) => [s.startTime, s.endTime]);
  const minTime = Math.min(...allTimes, 510); // at least 8:30
  const maxTime = Math.max(...allTimes, 930); // at least 3:30

  const rows: (string | null)[][] = [];
  // Track which class each cell belongs to for coloring: [row][col] → className
  const cellClasses: (string | null)[][] = [];

  // Header row
  const header = ['Time', ...sortedDays];
  rows.push(header);
  cellClasses.push(new Array(header.length).fill(null));

  // Generate time slots
  for (let t = minTime; t < maxTime; t += 30) {
    const timeLabel = `${minutesToTime(t)} - ${minutesToTime(t + 30)}`;
    const row: (string | null)[] = [timeLabel];
    const classRow: (string | null)[] = [null];

    for (const day of sortedDays) {
      const slot = sessions.filter(
        (s) => s.day === day && s.startTime === t
      );

      if (slot.length === 0) {
        row.push(null);
        classRow.push(null);
      } else {
        const names = slot
          .map((s) =>
            s.studentIds
              .map((id) => {
                const st = studentMap.get(id);
                return st ? `${st.firstName} ${st.lastName.charAt(0)}.` : id;
              })
              .join(', ')
          )
          .join(' | ');

        const types = slot.map((s) => {
          if (s.type === 'individual') return '1:1';
          if (s.type === 'pair') return '1:2';
          return `1:${s.studentIds.length}`;
        });

        row.push(`${names} (${types.join(', ')})`);

        // Determine class from first student of first session in this slot
        const firstStudent = studentMap.get(slot[0].studentIds[0]);
        classRow.push(firstStudent?.className ?? null);
      }
    }

    rows.push(row);
    cellClasses.push(classRow);
  }

  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Apply class-based cell colors
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const className = cellClasses[r]?.[c];
      if (!className) continue;
      const fill = CLASS_FILL[className];
      if (!fill) continue;

      const cellRef = XLSX.utils.encode_cell({ r, c });
      if (ws[cellRef]) {
        ws[cellRef].s = {
          fill: { patternType: 'solid', ...fill },
        };
      }
    }
  }

  // Style header row
  for (let c = 0; c < header.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[cellRef]) {
      ws[cellRef].s = {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } },
      };
    }
  }

  // Set column widths
  ws['!cols'] = [
    { wch: 20 },
    ...sortedDays.map(() => ({ wch: 35 })),
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');

  // Add student summary sheet
  const summaryRows: string[][] = [
    ['Student', 'Grade', 'Class', 'Mandate', 'Sessions Scheduled'],
  ];
  for (const student of students) {
    const sessionCount = sessions.filter((s) =>
      s.studentIds.includes(student.osisNumber)
    ).length;
    const totalRequired = student.mandateSessions.reduce(
      (sum, m) => sum + m.frequency,
      0
    );
    summaryRows.push([
      `${student.firstName} ${student.lastName}`,
      String(student.grade),
      student.className,
      student.mandateRaw,
      `${sessionCount}/${totalRequired}`,
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws2['!cols'] = [{ wch: 25 }, { wch: 8 }, { wch: 15 }, { wch: 20 }, { wch: 18 }];

  // Style summary header
  for (let c = 0; c < summaryRows[0].length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (ws2[cellRef]) {
      ws2[cellRef].s = {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } },
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws2, 'Student Summary');

  // Download
  XLSX.writeFile(wb, 'ot-schedule.xlsx');
}
