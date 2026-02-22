import { useAppStore } from '@/store/useAppStore';
import { generateSchedule } from '@/scheduling/algorithm';
import { validateSchedule } from '@/scheduling/validator';
import type { Student } from '@/types';

export function ModeSelector() {
  const {
    students,
    conflicts,
    config,
    providerSchedules,
    initialMappings,
    amandaSheetName,
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
    // Import from Amanda's existing sheet — try stored sheet name first, then fall back to name search
    const amandaSheet =
      providerSchedules.find((s) => s.sheetName === amandaSheetName) ??
      providerSchedules.find(
        (s) =>
          s.sheetName.toLowerCase().includes('amanda') ||
          s.sheetName.toLowerCase().includes('huang')
      );

    if (!amandaSheet) {
      handleGenerateFresh();
      return;
    }

    // Build lookup from initial mappings (primary strategy)
    const mappingLookup = new Map(
      initialMappings
        .filter((m) => m.studentId)
        .map((m) => [m.initial.toUpperCase(), m.studentId])
    );

    // Build direct-match indices for fallback resolution
    const fullNameIndex = new Map<string, Student>();
    const firstNameIndex = new Map<string, Student[]>();
    const initialsIndex = new Map<string, Student[]>();
    for (const s of students) {
      fullNameIndex.set(`${s.firstName} ${s.lastName}`.toLowerCase(), s);
      const fk = s.firstName.toLowerCase();
      if (!firstNameIndex.has(fk)) firstNameIndex.set(fk, []);
      firstNameIndex.get(fk)!.push(s);
      if (s.firstName.length > 0 && s.lastName.length > 0) {
        const initials = (s.firstName[0] + s.lastName[0]).toLowerCase();
        if (!initialsIndex.has(initials)) initialsIndex.set(initials, []);
        initialsIndex.get(initials)!.push(s);
      }
    }

    function resolveStudentName(name: string): string {
      const trimmed = name.trim();
      const upper = trimmed.toUpperCase();
      const lower = trimmed.toLowerCase();

      // 1. Initial mappings (highest priority — user-disambiguated)
      const fromMapping = mappingLookup.get(upper);
      if (fromMapping) return fromMapping;

      // 2. Full name match
      const fullMatch = fullNameIndex.get(lower);
      if (fullMatch) return fullMatch.osisNumber;

      // 3. First name match (only if unique)
      const firstMatch = firstNameIndex.get(lower);
      if (firstMatch && firstMatch.length === 1) return firstMatch[0].osisNumber;

      // 4. First+last initials (2-letter tokens)
      if (/^[A-Za-z]{2,3}$/.test(trimmed)) {
        const initMatch = initialsIndex.get(lower.slice(0, 2));
        if (initMatch && initMatch.length === 1) return initMatch[0].osisNumber;
      }

      // 5. First word as first name
      const firstWord = lower.split(/\s+/)[0]?.replace(/\.$/, '');
      if (firstWord && firstWord.length >= 2 && firstWord !== lower) {
        const fwMatch = firstNameIndex.get(firstWord);
        if (fwMatch && fwMatch.length === 1) return fwMatch[0].osisNumber;
      }

      return '';
    }

    const importedSessions = amandaSheet.sessions
      .map((es, idx) => {
        const studentIds = es.studentNames
          .map(resolveStudentName)
          .filter((id) => id !== '');

        // Deduplicate in case multiple names resolved to the same student
        const uniqueIds = [...new Set(studentIds)];

        if (uniqueIds.length === 0) return null;

        const mandateIndices: Record<string, number> = {};
        for (const sid of uniqueIds) {
          mandateIndices[sid] = 0; // best-guess on import, user can adjust
        }

        return {
          id: `imported-${idx}`,
          day: es.day,
          startTime: es.startTime,
          endTime: es.endTime,
          studentIds: uniqueIds,
          mandateIndices,
          type: (uniqueIds.length === 1
            ? 'individual'
            : uniqueIds.length === 2
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
