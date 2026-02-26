import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { minutesToTime, slotsOverlap } from '@/utils/timeUtils';
import { dayIndex } from '@/utils/timeUtils';
import type { ExternalSession, Student, ValidationError } from '@/types';
import { TimeSlotCell, type ActiveDragData } from './TimeSlotCell';

interface WeeklyGridProps {
  activeDrag: ActiveDragData | null;
  onRemoveStudent: (sessionId: string, studentId: string) => void;
}

export function WeeklyGrid({ activeDrag, onRemoveStudent }: WeeklyGridProps) {
  const {
    sessions,
    students,
    config,
    validationErrors,
    providerSchedules,
    providerView,
    excludedStudentIds,
    toggleExcludedStudent,
  } = useAppStore();

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.osisNumber, s])),
    [students]
  );

  const sortedDays = useMemo(
    () => [...config.activeDays].sort((a, b) => dayIndex(a) - dayIndex(b)),
    [config.activeDays]
  );

  // Generate time rows — extend start if external sessions begin before config.startTime
  const timeRows = useMemo(() => {
    let effectiveStart = config.startTime;

    if (providerView !== 'self' && providerSchedules.length > 0) {
      let earliest = config.startTime;
      for (const ps of providerSchedules) {
        for (const ext of ps.sessions) {
          if (ext.startTime < earliest) {
            earliest = ext.startTime;
          }
        }
      }
      const slotBoundary = Math.floor(earliest / config.slotDuration) * config.slotDuration;
      effectiveStart = Math.max(480, Math.min(slotBoundary, config.startTime)); // never before 8:00 AM
    }

    const rows: number[] = [];
    for (let t = effectiveStart; t < config.endTime; t += config.slotDuration) {
      rows.push(t);
    }
    return rows;
  }, [config, providerView, providerSchedules]);

  const errorsBySessionId = useMemo(() => {
    const map = new Map<string, ValidationError[]>();
    for (const e of validationErrors) {
      if (e.sessionId) {
        if (!map.has(e.sessionId)) map.set(e.sessionId, []);
        map.get(e.sessionId)!.push(e);
      }
    }
    return map;
  }, [validationErrors]);

  // Provider color palette for external sessions overlay
  const PROVIDER_COLORS = [
    { bg: 'bg-teal-100/70', border: 'border-teal-300', text: 'text-teal-800' },
    { bg: 'bg-rose-100/70', border: 'border-rose-300', text: 'text-rose-800' },
    { bg: 'bg-sky-100/70', border: 'border-sky-300', text: 'text-sky-800' },
    { bg: 'bg-lime-100/70', border: 'border-lime-300', text: 'text-lime-800' },
    { bg: 'bg-fuchsia-100/70', border: 'border-fuchsia-300', text: 'text-fuchsia-800' },
    { bg: 'bg-orange-100/70', border: 'border-orange-300', text: 'text-orange-800' },
    { bg: 'bg-slate-100/70', border: 'border-slate-300', text: 'text-slate-800' },
    { bg: 'bg-cyan-100/70', border: 'border-cyan-300', text: 'text-cyan-800' },
  ];

  const amandaSheetName = useAppStore((s) => s.amandaSheetName);

  // Build name indices for matching external student names against Amanda's roster
  const { nameIndex, fullNameIndex, initialsIndex } = useMemo(() => {
    const nameIdx = new Map<string, Student[]>();
    const fullIdx = new Map<string, Student>();
    const initIdx = new Map<string, Student[]>();
    for (const s of students) {
      const firstKey = s.firstName.toLowerCase();
      if (!nameIdx.has(firstKey)) nameIdx.set(firstKey, []);
      nameIdx.get(firstKey)!.push(s);
      fullIdx.set(`${s.firstName} ${s.lastName}`.toLowerCase(), s);
      if (s.firstName.length > 0 && s.lastName.length > 0) {
        const initials = (s.firstName[0] + s.lastName[0]).toLowerCase();
        if (!initIdx.has(initials)) initIdx.set(initials, []);
        initIdx.get(initials)!.push(s);
      }
    }
    return { nameIndex: nameIdx, fullNameIndex: fullIdx, initialsIndex: initIdx };
  }, [students]);

  const externalSessionsByCell = useMemo(() => {
    if (providerView === 'self') return new Map<string, { session: ExternalSession; providerName: string; colorIdx: number; matchedNames: { name: string; studentIds: string[] }[] }[]>();

    // Matches "OT" or "OT-" only when preceded by a space/start and followed by
    // a space or end of string — so "OT- Christina" matches but "Ot-Mann" does not.
    const isOtSheet = (name: string) => /^OT[\s-]/i.test(name);
    const otherProviders = providerSchedules.filter(
      (ps) => ps.sheetName !== amandaSheetName && !isOtSheet(ps.sheetName)
    );

    console.log(`[WeeklyGrid] providerView=${providerView}, amandaSheet="${amandaSheetName}"`);
    console.log(`[WeeklyGrid] ${providerSchedules.length} total providers, ${otherProviders.length} non-OT/non-self`);
    for (const ps of providerSchedules) {
      const excluded = ps.sheetName === amandaSheetName ? ' (SELF)' : isOtSheet(ps.sheetName) ? ' (OT-EXCLUDED)' : '';
      console.log(`  "${ps.sheetName}" — ${ps.sessions.length} sessions${excluded}`);
    }
    console.log(`[WeeklyGrid] ${students.length} students for matching, initialsIndex size=${initialsIndex.size}`);

    function findMatchedStudentIds(rawName: string): string[] {
      const lower = rawName.toLowerCase().trim();
      // Replace parenthetical with a space so surrounding words don't merge —
      // e.g. "Aqeela (Magnolia) push in" must stay "aqeela push in", not "aqeelapush in".
      const cleaned = lower.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length < 2) return [];

      const ids: string[] = [];
      const fullMatch = fullNameIndex.get(cleaned);
      if (fullMatch) {
        ids.push(fullMatch.osisNumber);
        return ids;
      }

      const firstNameMatch = nameIndex.get(cleaned);
      if (firstNameMatch) {
        return firstNameMatch.map((s) => s.osisNumber);
      }

      const firstWord = cleaned.split(/\s+/)[0].replace(/\.$/, '');
      if (firstWord && firstWord.length >= 2) {
        const firstWordMatch = nameIndex.get(firstWord);
        if (firstWordMatch) {
          return firstWordMatch.map((s) => s.osisNumber);
        }
      }

      const stripped = cleaned.replace(/\./g, '');
      if (stripped.length >= 2 && stripped.length <= 3) {
        const initials = stripped.slice(0, 2);
        const initialMatch = initialsIndex.get(initials);
        if (initialMatch) {
          return initialMatch.map((s) => s.osisNumber);
        }
      }

      if (cleaned.length >= 3) {
        for (const s of students) {
          const fn = s.firstName.toLowerCase();
          if (fn.length >= 3 && fn.includes(cleaned)) {
            ids.push(s.osisNumber);
          }
        }
      }

      return ids;
    }

    const excludedSet = new Set(excludedStudentIds);

    const map = new Map<string, { session: ExternalSession; providerName: string; colorIdx: number; matchedNames: { name: string; studentIds: string[] }[] }[]>();
    const { slotDuration, endTime: gridEnd } = config;
    const effectiveStart = timeRows.length > 0 ? timeRows[0] : config.startTime;
    let totalMatched = 0;
    let totalUnmatched = 0;
    otherProviders.forEach((ps, idx) => {
      const colorIdx = idx % PROVIDER_COLORS.length;
      let providerMatched = 0;
      for (const ext of ps.sessions) {
        const matchedNames: { name: string; studentIds: string[] }[] = [];
        for (const name of ext.studentNames) {
          const allIds = findMatchedStudentIds(name);
          const nonExcludedIds = allIds.filter((id) => !excludedSet.has(id));
          if (nonExcludedIds.length > 0) {
            matchedNames.push({ name, studentIds: nonExcludedIds });
          } else if (allIds.length > 0) {
            console.log(`  [match] "${ps.sheetName}" name "${name}" matched ${allIds.length} student(s) but ALL excluded`);
          }
        }
        if (matchedNames.length === 0) {
          totalUnmatched++;
          continue;
        }
        providerMatched++;
        totalMatched++;

        const entry = { session: ext, providerName: ps.providerName, colorIdx, matchedNames };

        for (let t = effectiveStart; t < gridEnd; t += slotDuration) {
          if (t < ext.endTime && ext.startTime < t + slotDuration) {
            const key = `${ext.day}-${t}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(entry);
          }
        }
      }
      console.log(`  [match] "${ps.sheetName}": ${providerMatched} sessions matched, ${ps.sessions.length - providerMatched} unmatched`);
    });
    console.log(`[WeeklyGrid] Total: ${totalMatched} matched sessions, ${totalUnmatched} unmatched. Map has ${map.size} cells.`);
    return map;
  }, [providerView, providerSchedules, amandaSheetName, students, nameIndex, fullNameIndex, initialsIndex, config, timeRows, excludedStudentIds]);

  return (
    <div className="overflow-auto h-full">
      <div className="min-w-[600px]">
        {/* Header */}
        <div
          className="grid sticky top-0 bg-white z-10 border-b-2 border-gray-300"
          style={{
            gridTemplateColumns: `80px repeat(${sortedDays.length}, 1fr)`,
          }}
        >
          <div className="p-2 text-xs font-semibold text-gray-500 border-r border-gray-200">
            Time
          </div>
          {sortedDays.map((day) => (
            <div
              key={day}
              className="p-2 text-sm font-semibold text-gray-700 text-center border-r border-gray-200"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Time rows */}
        {timeRows.map((time) => {
          const isLunch = slotsOverlap(
            time,
            time + config.slotDuration,
            config.lunchStart,
            config.lunchEnd
          );
          const isEarlyRow = time < config.startTime;

          return (
            <div
              key={time}
              className={`grid ${isEarlyRow ? 'bg-gray-50/50' : ''}`}
              style={{
                gridTemplateColumns: `80px repeat(${sortedDays.length}, 1fr)`,
              }}
            >
              {/* Time label */}
              <div className={`p-1 text-[11px] border-r border-b border-gray-200 flex items-start ${isEarlyRow ? 'text-gray-300' : 'text-gray-400'}`}>
                {minutesToTime(time)}
              </div>

              {/* Day cells */}
              {sortedDays.map((day) => {
                const cellSessions = providerView === 'others'
                  ? []
                  : sessions.filter((s) => s.day === day && s.startTime === time);

                const cellExternals = externalSessionsByCell.get(`${day}-${time}`) ?? [];

                return (
                  <TimeSlotCell
                    key={`${day}-${time}`}
                    day={day}
                    startTime={time}
                    sessions={cellSessions}
                    studentMap={studentMap}
                    isLunch={isLunch}
                    onRemoveStudent={onRemoveStudent}
                    errorsBySessionId={errorsBySessionId}
                    externalSessions={cellExternals}
                    providerColors={PROVIDER_COLORS}
                    onExcludeStudent={toggleExcludedStudent}
                    activeDrag={activeDrag}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
