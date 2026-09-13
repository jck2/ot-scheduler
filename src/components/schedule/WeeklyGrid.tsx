import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { minutesToTime, slotsOverlap } from '@/utils/timeUtils';
import { dayIndex } from '@/utils/timeUtils';
import type { ExternalSession, ValidationError } from '@/types';
import { buildNameIndex, matchExternalName } from '@/parsing/overlayMatcher';
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
    { bg: 'bg-violet-100/70', border: 'border-violet-300', text: 'text-violet-800' },
    { bg: 'bg-cyan-100/70', border: 'border-cyan-300', text: 'text-cyan-800' },
    { bg: 'bg-amber-100/70', border: 'border-amber-300', text: 'text-amber-800' },
    { bg: 'bg-emerald-100/70', border: 'border-emerald-300', text: 'text-emerald-800' },
    { bg: 'bg-pink-100/70', border: 'border-pink-300', text: 'text-pink-800' },
    { bg: 'bg-indigo-100/70', border: 'border-indigo-300', text: 'text-indigo-800' },
  ];

  const amandaSheetName = useAppStore((s) => s.amandaSheetName);

  // Build the name index for matching external student names against the roster.
  const nameIndex = useMemo(() => buildNameIndex(students), [students]);

  const externalSessionsByCell = useMemo(() => {
    if (providerView === 'self') return new Map<string, { session: ExternalSession; providerName: string; colorIdx: number; matchedNames: { name: string; studentIds: string[] }[] }[]>();

    // Matches "OT" or "OT-" only when preceded by a space/start and followed by
    // a space or end of string — so "OT- Christina" matches but "Ot-Mann" does not.
    const isOtSheet = (name: string) => /^OT[\s-]/i.test(name);
    const otherProviders = providerSchedules.filter(
      (ps) => ps.sheetName !== amandaSheetName && !isOtSheet(ps.sheetName)
    );

    const findMatchedStudentIds = (rawName: string) => matchExternalName(rawName, nameIndex);

    const excludedSet = new Set(excludedStudentIds);

    const map = new Map<string, { session: ExternalSession; providerName: string; colorIdx: number; matchedNames: { name: string; studentIds: string[] }[] }[]>();
    const { slotDuration, endTime: gridEnd } = config;
    const effectiveStart = timeRows.length > 0 ? timeRows[0] : config.startTime;
    otherProviders.forEach((ps, idx) => {
      const colorIdx = idx % PROVIDER_COLORS.length;
      for (const ext of ps.sessions) {
        const matchedNames: { name: string; studentIds: string[] }[] = [];
        for (const name of ext.studentNames) {
          const nonExcludedIds = findMatchedStudentIds(name).filter((id) => !excludedSet.has(id));
          if (nonExcludedIds.length > 0) {
            matchedNames.push({ name, studentIds: nonExcludedIds });
          }
        }
        if (matchedNames.length === 0) continue;

        const entry = { session: ext, providerName: ps.providerName, colorIdx, matchedNames };

        for (let t = effectiveStart; t < gridEnd; t += slotDuration) {
          if (t < ext.endTime && ext.startTime < t + slotDuration) {
            const key = `${ext.day}-${t}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(entry);
          }
        }
      }
    });
    return map;
  }, [providerView, providerSchedules, amandaSheetName, students, nameIndex, config, timeRows, excludedStudentIds]);

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
