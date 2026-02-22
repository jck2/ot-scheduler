import { useAppStore } from '@/store/useAppStore';

export function Header() {
  const step = useAppStore((s) => s.step);
  const resetAll = useAppStore((s) => s.resetAll);

  return (
    <header className="bg-indigo-600 text-white px-6 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">OT Schedule Builder</h1>
        <StepBadge step={step} />
      </div>
      <div className="flex items-center gap-4">
        {step !== 'upload' && (
          <button
            onClick={resetAll}
            className="text-sm text-indigo-200 hover:text-white transition-colors"
          >
            Start Over
          </button>
        )}
      </div>
    </header>
  );
}

function StepBadge({ step }: { step: string }) {
  const labels: Record<string, string> = {
    upload: 'Upload Files',
    'provider-select': 'Select Provider',
    disambiguation: 'Resolve Names',
    'mode-select': 'Choose Mode',
    schedule: 'Edit Schedule',
    export: 'Export',
  };
  return (
    <span className="text-xs bg-indigo-500 px-2 py-0.5 rounded-full">
      {labels[step] ?? step}
    </span>
  );
}
