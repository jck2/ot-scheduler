import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/store/useAppStore';
import { getMandateProgress } from '@/scheduling/validator';
import { MandateProgress } from './MandateProgress';
import type { Student } from '@/types';

function DraggableStudentRow({ student }: { student: Student }) {
  const sessions = useAppStore((s) => s.sessions);
  const progress = getMandateProgress(student, sessions);
  const hasUnfulfilled = progress.some((p) => p.scheduled < p.required);

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

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const s of filtered) {
      if (!map.has(s.className)) map.set(s.className, []);
      map.get(s.className)!.push(s);
    }
    return map;
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
        {Array.from(grouped.entries()).map(([className, classStudents]) => (
          <div key={className}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-1">
              {className}
            </h4>
            <div className="space-y-1">
              {classStudents.map((s) => (
                <DraggableStudentRow key={s.osisNumber} student={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
