import { useAppStore } from '@/store/useAppStore';
import { generateSchedule } from '@/scheduling/algorithm';
import { validateSchedule } from '@/scheduling/validator';

export function ModeSelector() {
  const {
    students,
    conflicts,
    config,
    providerSchedules,
    initialMappings,
    setSessions,
    setValidationErrors,
    setStep,
  } = useAppStore();

  function handleGenerateFresh() {
    const sessions = generateSchedule(students, conflicts, config);
    setSessions(sessions);
    const errors = validateSchedule(sessions, students, conflicts, config);
    setValidationErrors(errors);
    setStep('schedule');
  }

  function handleImportExisting() {
    // Import from Amanda's existing sheet
    const amandaSheet = providerSchedules.find(
      (s) =>
        s.sheetName.toLowerCase().includes('amanda') ||
        s.sheetName.toLowerCase().includes('huang')
    );

    if (!amandaSheet) {
      // No sheet found, generate fresh
      handleGenerateFresh();
      return;
    }

    // Map existing sessions using initial mappings
    const mappingLookup = new Map(
      initialMappings
        .filter((m) => m.studentId)
        .map((m) => [m.initial.toUpperCase(), m.studentId])
    );

    const importedSessions = amandaSheet.sessions
      .map((es, idx) => {
        const studentIds = es.studentNames
          .map((name) => {
            const upper = name.trim().toUpperCase();
            return mappingLookup.get(upper) ?? '';
          })
          .filter((id) => id !== '');

        if (studentIds.length === 0) return null;

        const mandateIndices: Record<string, number> = {};
        for (const sid of studentIds) {
          mandateIndices[sid] = 0; // best-guess on import, user can adjust
        }

        return {
          id: `imported-${idx}`,
          day: es.day,
          startTime: es.startTime,
          endTime: es.endTime,
          studentIds,
          mandateIndices,
          type: (studentIds.length === 1
            ? 'individual'
            : studentIds.length === 2
              ? 'pair'
              : 'group') as 'individual' | 'pair' | 'group',
          locked: false,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    setSessions(importedSessions);
    const errors = validateSchedule(importedSessions, students, conflicts, config);
    setValidationErrors(errors);
    setStep('schedule');
  }

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Schedule Mode</h2>
      <p className="text-gray-500 mb-8">
        Choose how to build your schedule. You can always edit it afterwards.
      </p>

      <div className="space-y-4">
        <button
          onClick={handleImportExisting}
          className="w-full p-6 border-2 border-gray-200 rounded-xl text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <h3 className="font-semibold text-gray-800">Import Existing Schedule</h3>
          <p className="text-sm text-gray-500 mt-1">
            Load your current schedule from the XLSX file and validate it against mandates.
          </p>
        </button>

        <button
          onClick={handleGenerateFresh}
          className="w-full p-6 border-2 border-gray-200 rounded-xl text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <h3 className="font-semibold text-gray-800">Generate Fresh Schedule</h3>
          <p className="text-sm text-gray-500 mt-1">
            Auto-generate an optimal schedule respecting all mandates, conflicts, and constraints.
          </p>
        </button>
      </div>

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
        <strong>{students.length}</strong> students loaded.{' '}
        {conflicts.length > 0 && (
          <>
            <strong>{conflicts.length}</strong> other-provider sessions detected
            — the scheduler will avoid these time slots automatically.
          </>
        )}
      </div>
    </div>
  );
}
