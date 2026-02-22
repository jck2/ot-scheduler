import type { Student } from '@/types';
import { getMandateProgress } from '@/scheduling/validator';
import { useAppStore } from '@/store/useAppStore';

interface MandateProgressProps {
  student: Student;
}

export function MandateProgress({ student }: MandateProgressProps) {
  const sessions = useAppStore((s) => s.sessions);
  const progress = getMandateProgress(student, sessions);

  return (
    <div className="flex gap-1">
      {progress.map((p) => {
        const complete = p.scheduled >= p.required;
        return (
          <span
            key={p.mandateIndex}
            className={`text-[10px] px-1 rounded ${
              complete
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {p.scheduled}/{p.required}
          </span>
        );
      })}
    </div>
  );
}
