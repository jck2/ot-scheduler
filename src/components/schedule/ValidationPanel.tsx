import { useAppStore } from '@/store/useAppStore';
import { minutesToTime } from '@/utils/timeUtils';

export function ValidationPanel() {
  const validationErrors = useAppStore((s) => s.validationErrors);
  const allConflicts = useAppStore((s) => s.conflicts);
  const excludedStudentIds = useAppStore((s) => s.excludedStudentIds);

  // Filter out conflicts and validation errors for excluded students
  const excludedSet = new Set(excludedStudentIds);
  const conflicts = allConflicts.filter((c) => !excludedSet.has(c.studentId));
  // Also filter cross-provider validation errors for excluded students
  const filteredValidationErrors = validationErrors.filter(
    (e) => !(e.type === 'cross_provider_conflict' && e.studentId && excludedSet.has(e.studentId))
  );

  const errors = filteredValidationErrors.filter((e) => e.severity === 'error');
  const warnings = filteredValidationErrors.filter((e) => e.severity === 'warning');

  if (errors.length === 0 && warnings.length === 0 && conflicts.length === 0) {
    return (
      <div className="p-3 bg-green-50 border-t border-green-200">
        <p className="text-sm text-green-700 font-medium">
          All mandates met. No scheduling conflicts.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 overflow-y-auto max-h-48">
      {errors.length > 0 && (
        <div className="p-2">
          <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">
            Errors ({errors.length})
          </h4>
          <div className="space-y-1">
            {errors.slice(0, 20).map((e, i) => (
              <p key={i} className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded">
                {e.message}
              </p>
            ))}
            {errors.length > 20 && (
              <p className="text-xs text-red-400">
                ...and {errors.length - 20} more
              </p>
            )}
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="p-2">
          <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
            Warnings ({warnings.length})
          </h4>
          <div className="space-y-1">
            {warnings.slice(0, 10).map((w, i) => (
              <p key={i} className="text-xs text-amber-600 px-2 py-1 bg-amber-50 rounded">
                {w.message}
              </p>
            ))}
          </div>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="p-2">
          <h4 className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">
            Other-Provider Sessions ({conflicts.length})
          </h4>
          <div className="space-y-1">
            {conflicts.slice(0, 20).map((c, i) => (
              <p key={i} className="text-xs text-blue-700 px-2 py-1 bg-blue-50 rounded">
                {c.studentName} — {c.otherProvider} {c.day} {minutesToTime(c.startTime)}–{minutesToTime(c.endTime)}
              </p>
            ))}
            {conflicts.length > 20 && (
              <p className="text-xs text-blue-400">
                ...and {conflicts.length - 20} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
