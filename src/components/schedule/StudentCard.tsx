import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import type { ScheduledSession, Student, ValidationError } from '@/types';
import { minutesToTime } from '@/utils/timeUtils';

// Card fill by grade level — Amanda's cells use SOLID, high-contrast colors so they
// stand out from the pale other-provider overlay. Cool hues (away from the amber
// warning ring and red error ring) keep those rings legible on any grade. Grade 4
// (blue) and 5 (violet) are the common ones.
const GRADE_STYLE: Record<number, string> = {
  [-1]: 'bg-pink-200',
  0: 'bg-fuchsia-200',
  1: 'bg-lime-200',
  2: 'bg-emerald-200',
  3: 'bg-teal-200',
  4: 'bg-sky-300',
  5: 'bg-violet-300',
};

export function gradeCardStyle(grade: number | undefined): string {
  return (grade !== undefined && GRADE_STYLE[grade]) || 'bg-slate-200';
}

export function gradeLabel(grade: number): string {
  if (grade === -1) return 'Pre-K';
  if (grade === 0) return 'K';
  return `Grade ${grade}`;
}

interface StudentCardProps {
  session: ScheduledSession;
  studentId: string;
  studentMap: Map<string, Student>;
  errors: ValidationError[];
  onRemoveStudent: (sessionId: string, studentId: string) => void;
  // All students sharing this slot (across every session in the cell). Individual
  // vs group is inferred from this co-location.
  slotStudentIds: string[];
  slotCount: number;
}

export function StudentCard({
  session,
  studentId,
  studentMap,
  errors,
  onRemoveStudent,
  slotStudentIds,
  slotCount,
}: StudentCardProps) {
  const dragId = `${session.id}::${studentId}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({ id: dragId });

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);
  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el);
    cardRef.current = el;
  };

  const student = studentMap.get(studentId);
  const firstName = student?.firstName ?? studentId.slice(0, 6);

  const isGroup = slotCount > 1;

  const fullNames = slotStudentIds.map((id) => {
    const s = studentMap.get(id);
    return s ? `${s.firstName} ${s.lastName}` : id;
  });

  const typeDescription =
    slotCount <= 1 ? 'Individual session' :
      slotCount === 2 ? 'Pair session (2 students)' :
        `Group session (${slotCount} students)`;

  const classes = new Set(
    slotStudentIds.map((id) => studentMap.get(id)?.className ?? '?')
  );

  const actualErrors = errors.filter((e) => e.severity === 'error');
  const warnings = errors.filter((e) => e.severity === 'warning');
  const hasActualError = actualErrors.length > 0;
  const hasWarning = warnings.length > 0;

  // Build tooltip lines
  const tooltipParts: string[] = [
    typeDescription,
    `${session.day} ${minutesToTime(session.startTime)}–${minutesToTime(session.endTime)}`,
    `Students: ${fullNames.join(', ')}`,
    `Class: ${Array.from(classes).join(', ')}`,
  ];
  if (actualErrors.length > 0) {
    tooltipParts.push('');
    for (const err of actualErrors) tooltipParts.push(`• ${err.message}`);
  }
  if (warnings.length > 0) {
    tooltipParts.push('');
    for (const w of warnings) tooltipParts.push(`• ${w.message}`);
  }

  return (
    <div
      ref={setRefs}
      {...attributes}
      {...listeners}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`${gradeCardStyle(student?.grade)} rounded px-2 py-0.5 text-xs cursor-grab active:cursor-grabbing group/card relative ${
        hasActualError ? 'ring-[3px] ring-red-500' : hasWarning ? 'ring-2 ring-amber-400' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium text-gray-800 truncate">
          {hasActualError && <span className="text-red-500 mr-0.5" title="Error">!</span>}
          {!hasActualError && hasWarning && (
            <span className="text-amber-400 mr-0.5 font-normal" title="Heads up (not blocking)">
              {'ⓘ'}
            </span>
          )}
          {firstName}
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          {isGroup && (
            <span className="text-[9px] text-gray-400 font-mono">[{slotCount}]</span>
          )}
        </span>
      </div>

      {/* Tooltip is portaled to <body> with fixed positioning so the grid's
          overflow container can never clip it — near the top OR bottom of screen. */}
      {hover && <CardTooltip anchor={cardRef.current} lines={tooltipParts} />}

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

const TOOLTIP_WIDTH = 240;

function CardTooltip({ anchor, lines }: { anchor: HTMLElement | null; lines: string[] }) {
  if (!anchor || typeof document === 'undefined') return null;
  const rect = anchor.getBoundingClientRect();

  // Flip below the card when there isn't room above (near the top of the screen).
  const estHeight = 20 + lines.length * 14;
  const showBelow = rect.top < estHeight + 12;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8));
  const top = showBelow ? rect.bottom + 6 : rect.top - 6;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{
        left,
        top,
        transform: showBelow ? 'none' : 'translateY(-100%)',
        maxWidth: TOOLTIP_WIDTH,
      }}
    >
      <div className="bg-gray-900 text-white text-[10px] leading-snug rounded px-2 py-1.5 shadow-lg whitespace-pre-wrap">
        {lines.map((line, i) => (
          <div key={i}>{line || ' '}</div>
        ))}
      </div>
    </div>,
    document.body
  );
}
