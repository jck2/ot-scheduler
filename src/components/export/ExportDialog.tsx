import { useAppStore } from '@/store/useAppStore';
import { exportScheduleXlsx } from '@/export/xlsxExporter';
import { exportScheduleIcs } from '@/export/icsExporter';

export function ExportDialog() {
  const { sessions, students, config, setStep } = useAppStore();

  function handleExportXlsx() {
    exportScheduleXlsx(sessions, students, config.activeDays);
  }

  function handleExportIcs() {
    exportScheduleIcs(sessions, students, config.termStartDate, config.termEndDate);
  }

  const totalRequired = students.reduce(
    (sum, s) => sum + s.mandateSessions.reduce((ms, m) => ms + m.frequency, 0),
    0
  );

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Export Schedule</h2>
      <p className="text-gray-500 mb-8">
        Download your schedule as a spreadsheet or calendar file.
      </p>

      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Sessions:</span>{' '}
            <span className="font-medium text-gray-800">{sessions.length}</span>
          </div>
          <div>
            <span className="text-gray-500">Required:</span>{' '}
            <span className="font-medium text-gray-800">{totalRequired}</span>
          </div>
          <div>
            <span className="text-gray-500">Students:</span>{' '}
            <span className="font-medium text-gray-800">{students.length}</span>
          </div>
          <div>
            <span className="text-gray-500">Days:</span>{' '}
            <span className="font-medium text-gray-800">
              {config.activeDays.map((d) => d.slice(0, 3)).join(', ')}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={handleExportXlsx}
          className="w-full p-4 border-2 border-gray-200 rounded-xl text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <h3 className="font-semibold text-gray-800">Download as Excel (.xlsx)</h3>
          <p className="text-sm text-gray-500 mt-1">
            Weekly grid format with student summary sheet.
          </p>
        </button>

        <button
          onClick={handleExportIcs}
          className="w-full p-4 border-2 border-gray-200 rounded-xl text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <h3 className="font-semibold text-gray-800">Download as Calendar (.ics)</h3>
          <p className="text-sm text-gray-500 mt-1">
            Recurring weekly events for Google Calendar, Outlook, etc.
          </p>
        </button>
      </div>

      <button
        onClick={() => setStep('schedule')}
        className="mt-6 w-full py-3 border-2 border-gray-200 text-gray-600 rounded-lg font-medium hover:border-gray-300 transition-colors"
      >
        Back to Schedule
      </button>
    </div>
  );
}
