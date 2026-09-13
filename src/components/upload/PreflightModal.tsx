import type { PreflightIssue, PreflightSeverity } from '@/scheduling/preflight';

interface PreflightModalProps {
  issues: PreflightIssue[];
  onProceed: () => void;
  onClose: () => void;
}

const SEVERITY_STYLES: Record<
  PreflightSeverity,
  { box: string; title: string; detail: string; label: string; badge: string }
> = {
  error: {
    box: 'border-red-200 bg-red-50',
    title: 'text-red-800',
    detail: 'text-red-700',
    label: 'Problem',
    badge: 'bg-red-100 text-red-700',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50',
    title: 'text-amber-800',
    detail: 'text-amber-700',
    label: 'Warning',
    badge: 'bg-amber-100 text-amber-700',
  },
  info: {
    box: 'border-blue-200 bg-blue-50',
    title: 'text-blue-800',
    detail: 'text-blue-700',
    label: 'Note',
    badge: 'bg-blue-100 text-blue-700',
  },
};

export function PreflightModal({ issues, onProceed, onClose }: PreflightModalProps) {
  const blocking = issues.some((i) => i.severity === 'error');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-800">
            {blocking ? "Can't build the schedule yet" : 'Before you build the schedule'}
          </h2>
          <p className="text-gray-500 text-sm mt-1 mb-5">
            {blocking
              ? 'Fix the problem below, then re-upload your files and try again.'
              : 'Here is what we found in your files. Review, then continue if it looks right.'}
          </p>

          <div className="space-y-3">
            {issues.map((issue, i) => {
              const styles = SEVERITY_STYLES[issue.severity];
              return (
                <div key={i} className={`border rounded-lg p-3 ${styles.box}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${styles.badge}`}
                    >
                      {styles.label}
                    </span>
                    <p className={`font-medium text-sm ${styles.title}`}>{issue.title}</p>
                  </div>
                  <p className={`text-sm ${styles.detail}`}>{issue.detail}</p>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              {blocking ? 'Close' : 'Cancel'}
            </button>
            {!blocking && (
              <button
                onClick={onProceed}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              >
                Continue anyway
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
