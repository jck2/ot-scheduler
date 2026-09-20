import { useDroppable } from '@dnd-kit/core';
import type { DayOfWeek, ExternalSession, ScheduledSession, Student, ValidationError } from '@/types';
import { minutesToTime } from '@/utils/timeUtils';
import { errorAppliesToCard } from '@/scheduling/validator';
import { StudentCard } from './StudentCard';

interface ProviderColor {
  bg: string;
  border: string;
  text: string;
}

export interface ExternalSessionEntry {
  session: ExternalSession;
  providerName: string;
  colorIdx: number;
  matchedNames: { name: string; studentIds: string[] }[];
}

export interface ActiveDragData {
  studentId: string;
  className: string;
  sourceSessionId?: string;
}

interface TimeSlotCellProps {
  day: DayOfWeek;
  startTime: number;
  sessions: ScheduledSession[];
  studentMap: Map<string, Student>;
  isLunch: boolean;
  bandBg?: string; // restricted-time-band highlight (e.g. 10–11, 11–12)
  onRemoveStudent: (sessionId: string, studentId: string) => void;
  validationErrors: ValidationError[];
  externalSessions: ExternalSessionEntry[];
  providerColors: ProviderColor[];
  onExcludeStudent?: (studentId: string) => void;
  activeDrag: ActiveDragData | null;
}

export function TimeSlotCell({
  day,
  startTime,
  sessions,
  studentMap,
  isLunch,
  bandBg,
  onRemoveStudent,
  validationErrors,
  externalSessions,
  providerColors,
  onExcludeStudent,
  activeDrag,
}: TimeSlotCellProps) {
  const droppableId = `${day}-${startTime}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  const hasExternals = externalSessions.length > 0;

  // Drops are always allowed now (co-location = intended group). When the group
  // that would result is problematic (different class, over the size cap), hint in
  // amber — the drop still works and the validator explains the issue afterward.
  let dropClean: boolean | null = null; // null = no active hover
  if (isOver && activeDrag) {
    dropClean = checkDropValid(activeDrag, sessions, studentMap);
  }

  const hoverClass = isOver
    ? dropClean === false
      ? 'ring-2 ring-amber-400 ring-inset'
      : 'ring-2 ring-indigo-300 ring-inset'
    : '';

  // Everyone scheduled in THIS slot (across every session in the cell). Grouping is
  // inferred from co-location, so all students sharing the slot are one group — even
  // if they came from separate session objects (manual drops, import).
  const slotStudentIds = [...new Set(sessions.flatMap((s) => s.studentIds))];
  const slotCount = slotStudentIds.length;

  // Flatten sessions into per-student entries
  const studentEntries: { session: ScheduledSession; studentId: string }[] = [];
  for (const session of sessions) {
    for (const sid of session.studentIds) {
      studentEntries.push({ session, studentId: sid });
    }
  }

  const renderStudentCards = () =>
    studentEntries.map(({ session, studentId }) => {
      // Each issue rings a card only when it names this session and this student
      // is a subject — so a conflict shows only on the conflicting card, an
      // over-cap warning only on the grouped cards, etc.
      const errors = validationErrors.filter((e) =>
        errorAppliesToCard(e, session.id, studentId)
      );
      return (
        <StudentCard
          key={`${session.id}::${studentId}`}
          session={session}
          studentId={studentId}
          studentMap={studentMap}
          errors={errors}
          onRemoveStudent={onRemoveStudent}
          slotStudentIds={slotStudentIds}
          slotCount={slotCount}
        />
      );
    });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[3rem] border-b border-r border-gray-200 ${
        isLunch ? 'bg-amber-50' : bandBg ?? ''
      } ${hoverClass}`}
    >
      {hasExternals ? (
        <div className="flex h-full">
          {/* Left half: Amanda's sessions */}
          <div className="flex-1 p-1 space-y-1.5 border-r border-gray-100">
            {renderStudentCards()}
          </div>
          {/* Right half: Other providers' roster students */}
          <div className="flex-1 p-1 space-y-1">
            {externalSessions.map((ext, i) => {
              const color = providerColors[ext.colorIdx];
              const timeRange = `${minutesToTime(ext.session.startTime)}\u2013${minutesToTime(ext.session.endTime)}`;
              // Strip category prefix (e.g. "Counseling- Elizabeth Grosser" → "Elizabeth Grosser")
              const displayName = ext.providerName.replace(/^[A-Za-z]+[-–—]\s*/, '');
              return (
                <div
                  key={`ext-${ext.providerName}-${i}`}
                  title={`${ext.providerName}\n${timeRange}\n${ext.matchedNames.map((m) => m.name).join(', ')}`}
                  className={`${color.bg} ${color.border} border rounded px-1 py-0.5 text-[10px]`}
                >
                  <div className={`font-medium ${color.text} truncate`}>
                    {displayName}
                  </div>
                  <div className="text-gray-500">
                    {ext.matchedNames.map((m, j) => (
                      <span key={j} className="inline-flex items-center gap-0.5">
                        {j > 0 && ', '}
                        {m.name}
                        {onExcludeStudent && m.studentIds.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onExcludeStudent(m.studentIds[0]);
                            }}
                            className="inline-flex items-center justify-center w-3 h-3 text-[8px] leading-none text-gray-400 hover:text-red-500 hover:bg-red-100 rounded-full"
                            title={`Hide ${m.name} from overlay`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="text-gray-400 truncate">
                    {timeRange}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-1 space-y-1.5">
          {renderStudentCards()}
        </div>
      )}
    </div>
  );
}

/** Check whether a drop would be valid for visual feedback */
function checkDropValid(
  drag: ActiveDragData,
  cellSessions: ScheduledSession[],
  studentMap: Map<string, Student>,
): boolean {
  // If no sessions in cell, drop is always valid (creates new session)
  if (cellSessions.length === 0) return true;

  // Check if there's a compatible session to merge into
  for (const session of cellSessions) {
    // Skip the source session (student already in it)
    if (drag.sourceSessionId && session.id === drag.sourceSessionId) continue;

    // Check same class
    const sessionClasses = new Set(
      session.studentIds.map((id) => studentMap.get(id)?.className ?? '?')
    );
    if (sessionClasses.size === 1 && sessionClasses.has(drag.className)) {
      // Check group size — all members must allow the new size
      const newSize = session.studentIds.length + 1;
      const allAllow = session.studentIds.every((sid) => {
        const s = studentMap.get(sid);
        if (!s) return false;
        const mi = session.mandateIndices[sid];
        const mandate = s.mandateSessions[mi];
        if (!mandate) return true;
        if (mandate.groupSize === 1) return false;
        const max = mandate.groupFlexible ? 3 : mandate.groupSize;
        return newSize <= max;
      });
      if (allAllow) return true;
    }
  }

  // No compatible session found, but cell might already have a session occupying the provider slot
  // Check provider double-booking: if there's already a session, a new one would double-book
  if (cellSessions.length > 0) {
    // Could still be valid if merging into existing session — but we already checked that above
    // So if we get here, it means the class doesn't match or group is full
    return false;
  }

  return true;
}
