import type { Student } from '@/types';
import { getStudentSessionSummary } from '@/scheduling/validator';
import { useAppStore } from '@/store/useAppStore';

interface MandateProgressProps {
  student: Student;
}

/**
 * Two chips per student:
 *  - Total: sessions placed / required (all sessions count, individual or group).
 *    Green when the required number is met, red when still short.
 *  - Group: group sessions used / max allowed. Only shown when the student is
 *    group-eligible. Grouping is optional, so this is red ONLY when the student
 *    is grouped more times than the mandate allows; otherwise it's neutral.
 */
export function MandateProgress({ student }: MandateProgressProps) {
  const sessions = useAppStore((s) => s.sessions);
  const summary = getStudentSessionSummary(student, sessions);

  const totalMet = summary.totalScheduled >= summary.totalRequired;
  const groupEligible = summary.maxGroupSessions > 0;
  const overGrouped = summary.groupedScheduled > summary.maxGroupSessions;
  const sizeLabel = summary.flexibleGroup ? '≤3' : `≤${summary.maxGroupSize}`;

  return (
    <div className="flex gap-1 items-center shrink-0">
      <span
        title="Total sessions placed / required per week"
        className={`text-[10px] px-1 rounded whitespace-nowrap ${
          totalMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}
      >
        <span className="opacity-60 mr-0.5">Total</span>
        {summary.totalScheduled}/{summary.totalRequired}
      </span>

      {groupEligible && (
        <span
          title={`Group sessions used / allowed (max group size ${sizeLabel.replace('≤', '')})`}
          className={`text-[10px] px-1 rounded whitespace-nowrap ${
            overGrouped ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <span className="opacity-60 mr-0.5">Group</span>
          {summary.groupedScheduled}/{summary.maxGroupSessions}
          <span className="opacity-50 ml-0.5">{sizeLabel}</span>
        </span>
      )}
    </div>
  );
}
