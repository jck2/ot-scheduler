import { useDraggable } from '@dnd-kit/core';
import type { ScheduledSession, Student, ValidationError } from '@/types';
import { minutesToTime } from '@/utils/timeUtils';

// Rotating colors for group visual linking
const GROUP_COLORS = [
  'border-l-violet-400',
  'border-l-teal-400',
  'border-l-orange-400',
  'border-l-pink-400',
  'border-l-cyan-400',
  'border-l-lime-400',
];

function groupColor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) | 0;
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

interface StudentCardProps {
  session: ScheduledSession;
  studentId: string;
  studentMap: Map<string, Student>;
  errors: ValidationError[];
  onRemoveStudent: (sessionId: string, studentId: string) => void;
}

export function StudentCard({
  session,
  studentId,
  studentMap,
  errors,
  onRemoveStudent,
}: StudentCardProps) {
  const dragId = `${session.id}::${studentId}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({ id: dragId });

  const student = studentMap.get(studentId);
  const firstName = student?.firstName ?? studentId.slice(0, 6);

  const isGroup = session.studentIds.length > 1;
  const groupBorder = isGroup ? groupColor(session.id) : '';

  const fullNames = session.studentIds.map((id) => {
    const s = studentMap.get(id);
    return s ? `${s.firstName} ${s.lastName}` : id;
  });

  const typeDescription =
    session.type === 'individual' ? 'Individual session' :
      session.type === 'pair' ? 'Pair session (2 students)' :
        `Group session (${session.studentIds.length} students)`;

  const classes = new Set(
    session.studentIds.map((id) => studentMap.get(id)?.className ?? '?')
  );

  const actualErrors = errors.filter((e) => e.severity === 'error');
  const warnings = errors.filter((e) => e.severity === 'warning');
  const hasActualError = actualErrors.length > 0;
  const hasWarning = warnings.length > 0;

  // Build tooltip lines
  const tooltipParts: string[] = [
    typeDescription,
    `${session.day} ${minutesToTime(session.startTime)}\u2013${minutesToTime(session.endTime)}`,
    `Students: ${fullNames.join(', ')}`,
    `Class: ${Array.from(classes).join(', ')}`,
  ];
  if (actualErrors.length > 0) {
    tooltipParts.push('');
    for (const err of actualErrors) tooltipParts.push(`\u2022 ${err.message}`);
  }
  if (warnings.length > 0) {
    tooltipParts.push('');
    for (const w of warnings) tooltipParts.push(`\u2022 ${w.message}`);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5 text-xs cursor-grab active:cursor-grabbing group/card relative ${
        isGroup ? `border-l-[3px] ${groupBorder}` : ''
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium text-gray-800 truncate">
          {hasActualError && <span className="text-red-500 mr-0.5">!!</span>}
          {!hasActualError && hasWarning && <span className="text-amber-500 mr-0.5">!</span>}
          {firstName}
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          {isGroup && (
            <span className="text-[9px] text-gray-400 font-mono">[{session.studentIds.length}]</span>
          )}
        </span>
      </div>
      {/* CSS hover tooltip — works even with drag listeners */}
      <div className="pointer-events-none absolute left-0 bottom-full mb-1 z-50 hidden group-hover/card:block">
        <div className="bg-gray-900 text-white text-[10px] leading-snug rounded px-2 py-1.5 shadow-lg whitespace-pre-wrap max-w-[220px]">
          {tooltipParts.map((line, i) => (
            <div key={i}>{line || '\u00A0'}</div>
          ))}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRemoveStudent(session.id, studentId);
        }}
        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] leading-none hidden group-hover/card:flex items-center justify-center"
      >
        x
      </button>
    </div>
  );
}
