import * as XLSX from 'xlsx';
import type { DayOfWeek, ExternalSession, ProviderSchedule } from '@/types';
import { SKIP_CELLS } from '@/utils/constants';
import { parseExcelTime, parseTimeRange } from '@/utils/timeUtils';

const DAY_NAMES: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Matches embedded time ranges like "8:15-9", "2:15-3pm", "(9:00-9:30)", "8:15–9:00"
const IN_CELL_TIME_RE = /\(?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*\)?/gi;

function parseInCellTimeToken(token: string): number | null {
  const cleaned = token.trim().toLowerCase();
  const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3];
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function extractInCellTime(
  text: string
): { start: number; end: number; cleanedText: string } | null {
  // Reset the global regex
  IN_CELL_TIME_RE.lastIndex = 0;
  const match = IN_CELL_TIME_RE.exec(text);
  if (!match) return null;

  let start = parseInCellTimeToken(match[1]);
  let end = parseInCellTimeToken(match[2]);
  if (start === null || end === null) return null;

  // AM/PM inference for school hours: if no explicit AM/PM suffix
  // and parsed minutes fall in 60–419 (1:00–6:59 AM range), assume PM
  const hasExplicitPeriod1 = /am|pm/i.test(match[1]);
  const hasExplicitPeriod2 = /am|pm/i.test(match[2]);
  if (!hasExplicitPeriod1 && start >= 60 && start <= 419) {
    start += 720;
  }
  if (!hasExplicitPeriod2 && end >= 60 && end <= 419) {
    end += 720;
  }

  // If end ≤ start after adjustment, add 12 hours to end
  if (end <= start) {
    end += 720;
  }

  // Remove ALL time-range patterns from text so time digits don't interfere with name splitting
  IN_CELL_TIME_RE.lastIndex = 0;
  const cleanedText = text.replace(IN_CELL_TIME_RE, ' ').replace(/\s+/g, ' ').trim();

  return { start, end, cleanedText };
}

export function parseXlsx(buffer: ArrayBuffer): ProviderSchedule[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const schedules: ProviderSchedule[] = [];

  for (const sheetName of workbook.SheetNames) {
    // Skip known non-schedule sheets
    if (sheetName.toLowerCase().includes('provider info')) continue;
    if (sheetName.toLowerCase().includes('info')) continue;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const parsed = parseScheduleSheet(sheet, sheetName);
    if (parsed) {
      schedules.push(parsed);
    }
  }

  return schedules;
}

function parseScheduleSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string
): ProviderSchedule | null {
  const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (data.length === 0) return null;

  // Find header row containing day names
  let headerRow = -1;
  let dayColumns: { day: DayOfWeek; col: number }[] = [];

  for (let r = 0; r < Math.min(data.length, 15); r++) {
    const row = data[r];
    if (!row) continue;
    const found: { day: DayOfWeek; col: number }[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '').trim().toLowerCase();
      for (const day of DAY_NAMES) {
        if (cell === day.toLowerCase()) {
          found.push({ day, col: c });
        }
      }
    }
    if (found.length >= 2) {
      headerRow = r;
      dayColumns = found;
      break;
    }
  }

  if (headerRow === -1) return null;

  // Find the time column (usually the first column or the one before Monday)
  const timeCol = dayColumns.length > 0 ? Math.max(0, dayColumns[0].col - 1) : 0;

  // Parse sidebar group definitions (columns to the right of the schedule)
  const groupLookup = parseSidebarGroups(data, dayColumns, headerRow);

  // Parse sessions
  const sessions: ExternalSession[] = [];

  for (let r = headerRow + 1; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;

    // Parse time from the time column (nullable — in-cell time can override)
    const timeCell = row[timeCol];
    const rowTime = parseTimeCellValue(timeCell);

    // Parse each day column
    for (const { day, col } of dayColumns) {
      const cellValue = row[col];
      if (!cellValue) continue;

      const cellText = String(cellValue).trim();
      if (!cellText) continue;

      // Skip non-schedule cells
      if (isSkipCell(cellText)) continue;

      // Try to extract an embedded time range from the cell text
      const inCellTime = extractInCellTime(cellText);
      const effectiveTime = inCellTime
        ? { start: inCellTime.start, end: inCellTime.end }
        : rowTime;

      // Skip this cell if no time is available from either source
      if (!effectiveTime) continue;

      // Use cleaned text (time stripped) when in-cell time was found
      const textForNames = inCellTime ? inCellTime.cleanedText : cellText;

      // Split multi-student cells, then expand any group references
      const rawNames = splitStudentNames(textForNames);
      const studentNames = expandGroupReferences(rawNames, groupLookup);
      if (studentNames.length === 0) continue;

      sessions.push({
        day,
        startTime: effectiveTime.start,
        endTime: effectiveTime.end,
        studentNames,
        rawText: cellText,
      });
    }
  }

  return {
    providerName: sheetName,
    sheetName,
    sessions,
  };
}

function applySchoolHourPmInference(time: { start: number; end: number }): { start: number; end: number } {
  let { start, end } = time;
  // If start falls in 1:00–6:59 AM range (60–419 min), assume PM for school hours
  if (start >= 60 && start <= 419) start += 720;
  if (end >= 60 && end <= 419) end += 720;
  // If end ≤ start after adjustment, add 12 hours to end
  if (end <= start) end += 720;
  return { start, end };
}

function parseTimeCellValue(cell: string | number | null): { start: number; end: number } | null {
  if (cell === null || cell === undefined) return null;

  // If it's an Excel serial number (fractional)
  if (typeof cell === 'number') {
    if (cell < 1 && cell > 0) {
      const start = parseExcelTime(cell);
      return applySchoolHourPmInference({ start, end: start + 30 });
    }
    // Could be a whole hour like 8 or 9
    if (cell >= 1 && cell <= 24) {
      const start = cell * 60;
      return applySchoolHourPmInference({ start, end: start + 30 });
    }
  }

  const text = String(cell).trim();
  if (!text) return null;

  // Try parsing as time range "8:30-9:00"
  const range = parseTimeRange(text);
  if (range) return applySchoolHourPmInference(range);

  return null;
}

function isSkipCell(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return SKIP_CELLS.some((skip) => lower.includes(skip));
}

function splitStudentNames(text: string): string[] {
  // Split by comma, semicolon, colon, slash, "+", or " & "/"and"
  return text
    .split(/[,;&/:]+|\+|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isSkipCell(s));
}

// --- Sidebar group parsing ---

const GROUP_KEYWORDS = [
  'group', 'ela', 'math', 'reading', 'writing', 'spelling', 'vocab', 'decoding',
];
const GRADE_ORDINAL_RE = /\b\d+(?:st|nd|rd|th)\b/i;

function isGroupHeader(text: string): boolean {
  const lower = text.toLowerCase();
  if (GROUP_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (GRADE_ORDINAL_RE.test(text)) return true;
  return false;
}

function cleanStudentName(text: string): string {
  // Strip frequency annotations like (3x), (4x), (Nx)
  return text.replace(/\s*\(\d+x?\)\s*/gi, '').trim();
}

function parseSidebarGroups(
  data: (string | number | null)[][],
  dayColumns: { day: DayOfWeek; col: number }[],
  headerRow: number
): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  if (dayColumns.length === 0) return lookup;

  const rightmostDayCol = Math.max(...dayColumns.map((d) => d.col));

  // Scan each column to the right of the schedule
  for (let c = rightmostDayCol + 1; c < (data[0]?.length ?? 0); c++) {
    let currentHeader: string | null = null;
    let currentMembers: string[] = [];

    for (let r = headerRow; r < data.length; r++) {
      const raw = data[r]?.[c];
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (!text) continue;

      if (isGroupHeader(text)) {
        // Flush previous group
        if (currentHeader && currentMembers.length > 0) {
          lookup.set(currentHeader, currentMembers);
        }
        currentHeader = text.toLowerCase();
        currentMembers = [];
      } else {
        // Treat as student name if it starts with a letter
        const cleaned = cleanStudentName(text);
        if (cleaned && /^[a-z]/i.test(cleaned)) {
          currentMembers.push(cleaned);
        }
      }
    }

    // Flush final group in this column
    if (currentHeader && currentMembers.length > 0) {
      lookup.set(currentHeader, currentMembers);
    }
  }

  return lookup;
}

// --- Group reference expansion ---

const STOP_WORDS = new Set([
  'push', 'pull', 'in', 'out', 'add', 'the', 'a', 'an', 'of', 'for', 'to', 'with',
]);

const GROUP_NUM_RE = /group\s*(\d+)/i;

function normalizeToWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return new Set(words);
}

function expandGroupReferences(
  names: string[],
  groupLookup: Map<string, string[]>
): string[] {
  if (groupLookup.size === 0) return names;

  const result: string[] = [];

  for (const name of names) {
    const match = findGroupMatch(name, groupLookup);
    if (match) {
      result.push(...match);
    } else {
      result.push(name);
    }
  }

  return result;
}

function findGroupMatch(
  token: string,
  groupLookup: Map<string, string[]>
): string[] | null {
  // Strategy 1: Numbered group match — e.g. "5th Group 2" matches "5th- ela group 2"
  const numMatch = GROUP_NUM_RE.exec(token);
  if (numMatch) {
    const groupNum = numMatch[1];
    const pattern = new RegExp(`group\\s*${groupNum}\\b`, 'i');
    for (const [key, members] of groupLookup) {
      if (pattern.test(key)) {
        return members;
      }
    }
  }

  // Strategy 2: Keyword overlap — at least 2 non-trivial words in common
  const tokenWords = normalizeToWords(token);
  if (tokenWords.size < 2) return null;

  for (const [key, members] of groupLookup) {
    const keyWords = normalizeToWords(key);
    let overlap = 0;
    for (const w of tokenWords) {
      if (keyWords.has(w)) overlap++;
    }
    if (overlap >= 2) {
      return members;
    }
  }

  return null;
}

export function findProviderSheet(
  schedules: ProviderSchedule[],
  providerName: string
): ProviderSchedule | undefined {
  const lower = providerName.toLowerCase();
  return schedules.find(
    (s) =>
      s.sheetName.toLowerCase().includes(lower) ||
      s.providerName.toLowerCase().includes(lower)
  );
}
