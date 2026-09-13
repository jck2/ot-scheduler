import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/store/useAppStore';
import { getStudentSessionSummary } from '@/scheduling/validator';
import { MandateProgress } from './MandateProgress';
import type { Student } from '@/types';

function DraggableStudentRow({ student }: { student: Student }) {
  const sessions = useAppStore((s) => s.sessions);
  const summary = getStudentSessionSummary(student, sessions);
  const hasUnfulfilled = summary.totalScheduled < summary.totalRequired;

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `roster::${student.osisNumber}`,
    disabled: !hasUnfulfilled,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`flex items-center justify-between px-2 py-1.5 bg-white rounded border border-gray-100 hover:border-gray-200 ${
        hasUnfulfilled ? 'cursor-grab active:cursor-grabbing' : 'opacity-60'
      }`}
    >
      <div>
        <p className="text-xs font-medium text-gray-800">
          {student.firstName} {student.lastName}
        </p>
        <p className="text-[10px] text-gray-400">
          {student.mandateRaw}
        </p>
      </div>
      <MandateProgress student={student} />
    </div>
  );
}

export function StudentList() {
  const students = useAppStore((s) => s.students);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return students;
    const lower = filter.toLowerCase();
    return students.filter(
      (s) =>
        s.firstName.toLowerCase().includes(lower) ||
        s.lastName.toLowerCase().includes(lower) ||
        s.className.toLowerCase().includes(lower)
    );
  }, [students, filter]);

  // Group by class, but normalize the key (trim + case-insensitive) so "Elm",
  // "elm " and "ELM" collapse into one group instead of separate headers. Students
  // with no class listed go into a single labeled bucket rendered last, rather than
  // under a blank header.
  const NO_CLASS = 'No class listed';
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; students: typeof filtered }>();
    for (const s of filtered) {
      const trimmed = s.className.trim();
      const key = trimmed ? trimmed.toLowerCase() : '__none__';
      const label = trimmed || NO_CLASS;
      if (!map.has(key)) map.set(key, { label, students: [] });
      map.get(key)!.students.push(s);
    }
    return [...map.values()].sort((a, b) => {
      // Named classes first (alphabetical), the "no class" bucket last.
      if (a.label === NO_CLASS) return 1;
      if (b.label === NO_CLASS) return -1;
      return a.label.localeCompare(b.label);
    });
  }, [filtered]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Students ({students.length})
        </h3>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-indigo-400"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groups.map((group) => (
          <div key={group.label}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-1">
              {group.label}{' '}
              <span className="text-gray-300 normal-case">({group.students.length})</span>
            </h4>
            <div className="space-y-1">
              {group.students.map((s) => (
                <DraggableStudentRow key={s.osisNumber} student={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
