import { useAppStore } from '@/store/useAppStore';

export function DisambiguationModal() {
  const initialMappings = useAppStore((s) => s.initialMappings);
  const resolveMapping = useAppStore((s) => s.resolveMapping);
  const setStep = useAppStore((s) => s.setStep);

  const ambiguous = initialMappings.filter((m) => m.confidence === 'ambiguous');
  const unknown = initialMappings.filter((m) => m.confidence === 'unknown');

  const allResolved = ambiguous.every(
    (m) => m.studentId && m.confidence !== 'ambiguous'
  );

  function handleResolve(initial: string, studentId: string) {
    resolveMapping(initial, studentId);
  }

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Resolve Ambiguous Names</h2>
      <p className="text-gray-500 mb-8">
        Some initials in the schedule could match multiple students.
        Please confirm each one.
      </p>

      {ambiguous.length > 0 && (
        <div className="space-y-4 mb-8">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
            Ambiguous Initials
          </h3>
          {ambiguous.map((mapping) => (
            <div
              key={mapping.initial}
              className="border border-amber-200 bg-amber-50 rounded-lg p-4"
            >
              <p className="font-medium text-gray-800 mb-2">
                "{mapping.initial}" could be:
                {mapping.sourceSheet && (
                  <span className="ml-2 text-sm font-normal text-amber-600">
                    Found in: {mapping.sourceSheet}
                  </span>
                )}
              </p>
              <div className="space-y-2">
                {mapping.candidates?.map((c) => (
                  <label
                    key={c.studentId}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-amber-100 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={`disambig-${mapping.initial}`}
                      checked={mapping.studentId === c.studentId}
                      onChange={() => handleResolve(mapping.initial, c.studentId)}
                      className="text-indigo-600"
                    />
                    <span className="text-gray-700">
                      {c.name}{' '}
                      <span className="text-gray-400 text-sm">({c.className})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {unknown.length > 0 && (
        <div className="space-y-2 mb-8">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
            Unknown Initials (not in roster)
          </h3>
          {unknown.map((m) => (
            <div
              key={m.initial}
              className="border border-gray-200 bg-gray-50 rounded-lg p-3 text-gray-600 text-sm"
            >
              "{m.initial}" — not found in your roster. This will be skipped.
              {m.sourceSheet && (
                <span className="ml-1 text-gray-400">
                  (from: {m.sourceSheet})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setStep('mode-select')}
        disabled={!allResolved && ambiguous.length > 0}
        className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
