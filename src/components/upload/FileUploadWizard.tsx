import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { parseRosterCSV, filterByProvider, getProviderNames } from '@/parsing/rosterParser';
import { parseXlsx } from '@/parsing/xlsxParser';
import { detectCrossProviderConflicts } from '@/scheduling/conflictDetector';
import { resolveInitialsInSession } from '@/parsing/initialMatcher';
import { FileDropZone } from './FileDropZone';

export function FileUploadWizard() {
  const {
    setAllStudents,
    setStudents,
    setProviderSchedules,
    setAmandaSheetName,
    setConflicts,
    setInitialMappings,
    setStep,
    setSelectedProvider,
  } = useAppStore();

  const [rosterFile, setRosterFile] = useState<File | null>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleProcess() {
    if (!rosterFile || !xlsxFile) return;
    setProcessing(true);
    setError(null);

    try {
      // Parse roster CSV
      const csvText = await rosterFile.text();
      const allStudents = parseRosterCSV(csvText);
      setAllStudents(allStudents);

      // Auto-detect provider
      const providers = getProviderNames(allStudents);
      const amandaMatch = providers.find((p) => p.toLowerCase().includes('amanda'));
      const providerName = amandaMatch ?? providers[0] ?? 'Amanda Huang';
      setSelectedProvider(providerName);

      const myStudents = filterByProvider(allStudents, providerName);
      setStudents(myStudents);

      // Parse XLSX
      const buffer = await xlsxFile.arrayBuffer();
      const schedules = parseXlsx(buffer);
      setProviderSchedules(schedules);

      // Detect cross-provider conflicts
      const amandaSheet = schedules.find(
        (s) =>
          s.sheetName.toLowerCase().includes('amanda') ||
          s.sheetName.toLowerCase().includes('huang')
      );
      setAmandaSheetName(amandaSheet?.sheetName ?? '');
      const conflicts = detectCrossProviderConflicts(
        myStudents,
        schedules,
        amandaSheet?.sheetName ?? ''
      );
      setConflicts(conflicts);

      // Resolve initials from Amanda's sheet
      if (amandaSheet) {
        const allMappings = amandaSheet.sessions.flatMap((session) =>
          resolveInitialsInSession(session.rawText, myStudents).map((m) => ({
            ...m,
            sourceSheet: amandaSheet.sheetName,
          }))
        );
        // Deduplicate by initial
        const seen = new Set<string>();
        const unique = allMappings.filter((m) => {
          if (seen.has(m.initial)) return false;
          seen.add(m.initial);
          return true;
        });
        setInitialMappings(unique);

        // Check if disambiguation is needed
        const ambiguous = unique.filter((m) => m.confidence === 'ambiguous');
        if (ambiguous.length > 0) {
          setStep('disambiguation');
        } else {
          setStep('mode-select');
        }
      } else {
        setStep('mode-select');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse files');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload Files</h2>
      <p className="text-gray-500 mb-8">
        Upload the student roster CSV and the master schedules XLSX to get started.
      </p>

      <div className="space-y-4">
        <FileDropZone
          label="Student Roster (.csv)"
          accept=".csv"
          onFile={setRosterFile}
          fileName={rosterFile?.name}
        />
        <FileDropZone
          label="Master Schedules (.xlsx)"
          accept=".xlsx,.xls"
          onFile={setXlsxFile}
          fileName={xlsxFile?.name}
        />
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleProcess}
        disabled={!rosterFile || !xlsxFile || processing}
        className="mt-6 w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {processing ? 'Processing...' : 'Process Files'}
      </button>
    </div>
  );
}
