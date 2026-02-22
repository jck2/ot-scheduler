import { create } from 'zustand';
import type {
  AppConfig,
  AppStep,
  Conflict,
  InitialMapping,
  ProviderSchedule,
  ScheduledSession,
  Student,
  ValidationError,
} from '@/types';
import { DEFAULT_CONFIG } from '@/utils/constants';
import { debouncedSave, loadState } from './persistence';

interface AppState {
  // Navigation
  step: AppStep;
  setStep: (step: AppStep) => void;

  // Students & roster
  allStudents: Student[];
  students: Student[]; // filtered to provider
  setAllStudents: (students: Student[]) => void;
  setStudents: (students: Student[]) => void;

  // Provider selection
  selectedProvider: string;
  setSelectedProvider: (name: string) => void;

  // XLSX data
  providerSchedules: ProviderSchedule[];
  setProviderSchedules: (schedules: ProviderSchedule[]) => void;
  amandaSheetName: string;
  setAmandaSheetName: (name: string) => void;

  // Initial disambiguation
  initialMappings: InitialMapping[];
  setInitialMappings: (mappings: InitialMapping[]) => void;
  resolveMapping: (initial: string, studentId: string) => void;

  // Schedule
  sessions: ScheduledSession[];
  setSessions: (sessions: ScheduledSession[]) => void;
  addSession: (session: ScheduledSession) => void;
  updateSession: (id: string, updates: Partial<ScheduledSession>) => void;
  removeSession: (id: string) => void;
  moveSession: (id: string, day: ScheduledSession['day'], startTime: number) => void;
  removeStudentFromSession: (sessionId: string, studentId: string) => void;
  addStudentToSession: (sessionId: string, studentId: string, mandateIndex: number) => void;

  // Conflicts
  conflicts: Conflict[];
  setConflicts: (conflicts: Conflict[]) => void;

  // Validation
  validationErrors: ValidationError[];
  setValidationErrors: (errors: ValidationError[]) => void;

  // Other providers overlay
  providerView: 'self' | 'others' | 'both';
  setProviderView: (view: 'self' | 'others' | 'both') => void;

  // Student exclusion from overlay
  excludedStudentIds: string[];
  toggleExcludedStudent: (studentId: string) => void;

  // Config
  config: AppConfig;
  updateConfig: (updates: Partial<AppConfig>) => void;

  // Persistence
  loadFromStorage: () => Promise<void>;
  resetAll: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  step: 'upload',
  setStep: (step) => set({ step }),

  allStudents: [],
  students: [],
  setAllStudents: (allStudents) => {
    set({ allStudents });
    persistState(get());
  },
  setStudents: (students) => {
    set({ students });
    persistState(get());
  },

  selectedProvider: DEFAULT_CONFIG.providerName,
  setSelectedProvider: (selectedProvider) => {
    set({ selectedProvider });
    persistState(get());
  },

  providerSchedules: [],
  setProviderSchedules: (providerSchedules) => {
    set({ providerSchedules });
    persistState(get());
  },
  amandaSheetName: '',
  setAmandaSheetName: (amandaSheetName) => set({ amandaSheetName }),

  initialMappings: [],
  setInitialMappings: (initialMappings) => set({ initialMappings }),
  resolveMapping: (initial, studentId) => {
    const mappings = get().initialMappings.map((m) =>
      m.initial === initial ? { ...m, studentId, confidence: 'exact' as const } : m
    );
    set({ initialMappings: mappings });
  },

  sessions: [],
  setSessions: (sessions) => {
    set({ sessions });
    persistState(get());
  },
  addSession: (session) => {
    const sessions = [...get().sessions, session];
    set({ sessions });
    persistState(get());
  },
  updateSession: (id, updates) => {
    const sessions = get().sessions.map((s) =>
      s.id === id ? { ...s, ...updates } : s
    );
    set({ sessions });
    persistState(get());
  },
  removeSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    set({ sessions });
    persistState(get());
  },
  moveSession: (id, day, startTime) => {
    const sessions = get().sessions.map((s) =>
      s.id === id
        ? { ...s, day, startTime, endTime: startTime + (s.endTime - s.startTime) }
        : s
    );
    set({ sessions });
    persistState(get());
  },
  removeStudentFromSession: (sessionId, studentId) => {
    let sessions = get().sessions;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const newStudentIds = session.studentIds.filter((id) => id !== studentId);
    if (newStudentIds.length === 0) {
      // Session becomes empty — delete it
      sessions = sessions.filter((s) => s.id !== sessionId);
    } else {
      const { [studentId]: _, ...newMandateIndices } = session.mandateIndices;
      const type: ScheduledSession['type'] =
        newStudentIds.length === 1 ? 'individual' : newStudentIds.length === 2 ? 'pair' : 'group';
      sessions = sessions.map((s) =>
        s.id === sessionId
          ? { ...s, studentIds: newStudentIds, mandateIndices: newMandateIndices, type }
          : s
      );
    }
    set({ sessions });
    persistState(get());
  },
  addStudentToSession: (sessionId, studentId, mandateIndex) => {
    const sessions = get().sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const newStudentIds = [...s.studentIds, studentId];
      const newMandateIndices = { ...s.mandateIndices, [studentId]: mandateIndex };
      const type: ScheduledSession['type'] =
        newStudentIds.length === 1 ? 'individual' : newStudentIds.length === 2 ? 'pair' : 'group';
      return { ...s, studentIds: newStudentIds, mandateIndices: newMandateIndices, type };
    });
    set({ sessions });
    persistState(get());
  },

  conflicts: [],
  setConflicts: (conflicts) => set({ conflicts }),

  validationErrors: [],
  setValidationErrors: (validationErrors) => set({ validationErrors }),

  providerView: 'both' as const,
  setProviderView: (providerView) => set({ providerView }),

  excludedStudentIds: [],
  toggleExcludedStudent: (studentId) => {
    const current = get().excludedStudentIds;
    const next = current.includes(studentId)
      ? current.filter((id) => id !== studentId)
      : [...current, studentId];
    set({ excludedStudentIds: next });
    persistState(get());
  },

  config: { ...DEFAULT_CONFIG },
  updateConfig: (updates) => {
    const config = { ...get().config, ...updates };
    set({ config });
    persistState(get());
  },

  loadFromStorage: async () => {
    try {
      const saved = await loadState<PersistedState>('app-state');
      if (saved) {
        set({
          allStudents: saved.allStudents ?? [],
          students: saved.students ?? [],
          selectedProvider: saved.selectedProvider ?? DEFAULT_CONFIG.providerName,
          sessions: saved.sessions ?? [],
          config: saved.config ?? { ...DEFAULT_CONFIG },
          step: saved.step ?? 'upload',
          excludedStudentIds: saved.excludedStudentIds ?? [],
        });
      }
    } catch (e) {
      console.error('Failed to load from storage:', e);
    }
  },

  resetAll: () => {
    set({
      step: 'upload',
      allStudents: [],
      students: [],
      selectedProvider: DEFAULT_CONFIG.providerName,
      providerSchedules: [],
      amandaSheetName: '',
      initialMappings: [],
      sessions: [],
      conflicts: [],
      validationErrors: [],
      config: { ...DEFAULT_CONFIG },
      excludedStudentIds: [],
    });
  },
}));

interface PersistedState {
  allStudents: Student[];
  students: Student[];
  selectedProvider: string;
  sessions: ScheduledSession[];
  config: AppConfig;
  step: AppStep;
  excludedStudentIds?: string[];
}

let manualIdCounter = 0;

export function initManualIdCounter(sessions: ScheduledSession[]) {
  let max = 0;
  for (const s of sessions) {
    const match = s.id.match(/^manual-(\d+)$/);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  manualIdCounter = max;
}

export function nextSessionId(): string {
  return `manual-${++manualIdCounter}`;
}

function persistState(state: AppState) {
  const data: PersistedState = {
    allStudents: state.allStudents,
    students: state.students,
    selectedProvider: state.selectedProvider,
    sessions: state.sessions,
    config: state.config,
    step: state.step,
    excludedStudentIds: state.excludedStudentIds,
  };
  debouncedSave('app-state', data);
}
