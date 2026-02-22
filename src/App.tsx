import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { AppShell } from '@/components/layout/AppShell';
import { FileUploadWizard } from '@/components/upload/FileUploadWizard';
import { DisambiguationModal } from '@/components/upload/DisambiguationModal';
import { ModeSelector } from '@/components/upload/ModeSelector';
import { ScheduleView } from '@/components/schedule/ScheduleView';
import { ExportDialog } from '@/components/export/ExportDialog';

function App() {
  const step = useAppStore((s) => s.step);
  const loadFromStorage = useAppStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  return (
    <AppShell>
      {step === 'upload' && <FileUploadWizard />}
      {step === 'provider-select' && <FileUploadWizard />}
      {step === 'disambiguation' && <DisambiguationModal />}
      {step === 'mode-select' && <ModeSelector />}
      {step === 'schedule' && <ScheduleView />}
      {step === 'export' && <ExportDialog />}
    </AppShell>
  );
}

export default App;
