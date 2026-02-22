import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useAppStore } from '@/store/useAppStore';
import { nextSessionId, initManualIdCounter } from '@/store/useAppStore';
import { validateSchedule, getMandateProgress } from '@/scheduling/validator';
import type { DayOfWeek, ScheduledSession } from '@/types';
import { WeeklyGrid } from './WeeklyGrid';
import { StudentList } from '../roster/StudentList';
import { ValidationPanel } from './ValidationPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import type { ActiveDragData } from './TimeSlotCell';

function ColorKey() {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-600">
      <div className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded border bg-indigo-50 border-indigo-200" />
        <span>Amanda</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-red-500 font-bold">!!</span>
        <span>Error</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-amber-500 font-bold">!</span>
        <span>Warning</span>
      </div>
    </div>
  );
}

export function ScheduleView() {
  const setStep = useAppStore((s) => s.setStep);
  const sessions = useAppStore((s) => s.sessions);
  const students = useAppStore((s) => s.students);
  const conflicts = useAppStore((s) => s.conflicts);
  const config = useAppStore((s) => s.config);
  const validationErrors = useAppStore((s) => s.validationErrors);
  const setValidationErrors = useAppStore((s) => s.setValidationErrors);
  const showOtherProviders = useAppStore((s) => s.showOtherProviders);
  const setShowOtherProviders = useAppStore((s) => s.setShowOtherProviders);
  const excludedStudentIds = useAppStore((s) => s.excludedStudentIds);
  const toggleExcludedStudent = useAppStore((s) => s.toggleExcludedStudent);
  const addSession = useAppStore((s) => s.addSession);
  const addStudentToSession = useAppStore((s) => s.addStudentToSession);
  const removeStudentFromSession = useAppStore((s) => s.removeStudentFromSession);
  const [showSettings, setShowSettings] = useState(false);

  // Active drag state for visual feedback
  const [activeDrag, setActiveDrag] = useState<ActiveDragData | null>(null);
  // Drag overlay label
  const [dragOverlayLabel, setDragOverlayLabel] = useState<string | null>(null);

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.osisNumber, s])),
    [students]
  );

  // Filter conflicts by excluded student IDs
  const filteredConflicts = useMemo(() => {
    const excludedSet = new Set(excludedStudentIds);
    return conflicts.filter((c) => !excludedSet.has(c.studentId));
  }, [conflicts, excludedStudentIds]);

  // Initialize manual ID counter from existing sessions
  useMemo(() => {
    initManualIdCounter(sessions);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build a map of excluded student ID → display name for restore pills
  const excludedStudents = excludedStudentIds
    .map((id) => {
      const s = students.find((st) => st.osisNumber === id);
      if (!s) return null;
      const initial = s.lastName.length > 0 ? ` ${s.lastName[0]}.` : '';
      return { id, label: `${s.firstName}${initial}` };
    })
    .filter((x): x is { id: string; label: string } => x !== null);

  const errorCount = validationErrors.filter((e) => e.severity === 'error').length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const revalidate = useCallback(() => {
    const updated = useAppStore.getState().sessions;
    const errors = validateSchedule(updated, students, filteredConflicts, config);
    setValidationErrors(errors);
  }, [students, filteredConflicts, config, setValidationErrors]);

  const handleRemoveStudent = useCallback(
    (sessionId: string, studentId: string) => {
      removeStudentFromSession(sessionId, studentId);
      revalidate();
    },
    [removeStudentFromSession, revalidate]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const rawId = event.active.id as string;

      if (rawId.startsWith('roster::')) {
        // Roster drag
        const osisNumber = rawId.slice('roster::'.length);
        const student = studentMap.get(osisNumber);
        if (!student) return;
        setActiveDrag({
          studentId: osisNumber,
          className: student.className,
        });
        setDragOverlayLabel(`${student.firstName} ${student.lastName}`);
      } else if (rawId.includes('::')) {
        // Grid drag: sessionId::studentId
        const [sessionId, studentId] = rawId.split('::');
        const student = studentMap.get(studentId);
        const session = sessions.find((s) => s.id === sessionId);
        if (!student || !session) return;
        setActiveDrag({
          studentId,
          className: student.className,
          sourceSessionId: sessionId,
        });
        setDragOverlayLabel(student.firstName);
      }
    },
    [studentMap, sessions]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      setDragOverlayLabel(null);

      const { active, over } = event;
      if (!over) return;

      const rawActiveId = active.id as string;
      const rawOverId = over.id as string;

      // Parse target cell
      const dashIdx = rawOverId.indexOf('-');
      if (dashIdx === -1) return;
      const day = rawOverId.slice(0, dashIdx) as DayOfWeek;
      const startTime = parseInt(rawOverId.slice(dashIdx + 1), 10);
      if (isNaN(startTime)) return;

      const currentSessions = useAppStore.getState().sessions;

      if (rawActiveId.startsWith('roster::')) {
        // --- Roster → Grid ---
        const osisNumber = rawActiveId.slice('roster::'.length);
        const student = studentMap.get(osisNumber);
        if (!student) return;

        // Find first unfulfilled mandate
        const progress = getMandateProgress(student, currentSessions);
        const unfulfilledMandate = progress.find((p) => p.scheduled < p.required);
        if (!unfulfilledMandate) return; // all mandates fulfilled

        const mandateIndex = unfulfilledMandate.mandateIndex;
        const mandate = student.mandateSessions[mandateIndex];

        handleDrop(
          osisNumber,
          student.className,
          mandateIndex,
          mandate.duration,
          day,
          startTime,
          currentSessions,
          undefined, // no source session
        );
      } else if (rawActiveId.includes('::')) {
        // --- Grid → Grid ---
        const [sourceSessionId, studentId] = rawActiveId.split('::');
        const student = studentMap.get(studentId);
        const sourceSession = currentSessions.find((s) => s.id === sourceSessionId);
        if (!student || !sourceSession) return;

        // Don't move if dropped on the same cell
        if (sourceSession.day === day && sourceSession.startTime === startTime) return;

        const mandateIndex = sourceSession.mandateIndices[studentId];
        const duration = sourceSession.endTime - sourceSession.startTime;

        handleDrop(
          studentId,
          student.className,
          mandateIndex,
          duration,
          day,
          startTime,
          currentSessions,
          sourceSessionId,
        );
      }
    },
    [studentMap] // handleDrop is stable, defined below
  );

  function handleDrop(
    studentId: string,
    className: string,
    mandateIndex: number,
    duration: number,
    day: DayOfWeek,
    startTime: number,
    currentSessions: ScheduledSession[],
    sourceSessionId: string | undefined,
  ) {
    // Find compatible existing session in target cell
    const cellSessions = currentSessions.filter(
      (s) => s.day === day && s.startTime === startTime
    );

    let merged = false;
    for (const session of cellSessions) {
      // Skip if it's the source session
      if (sourceSessionId && session.id === sourceSessionId) continue;

      // Check same class
      const sessionClasses = new Set(
        session.studentIds.map((id) => studentMap.get(id)?.className ?? '?')
      );
      if (sessionClasses.size !== 1 || !sessionClasses.has(className)) continue;

      // Check group size constraints
      const newSize = session.studentIds.length + 1;
      const allAllow = session.studentIds.every((sid) => {
        const s = studentMap.get(sid);
        if (!s) return false;
        const mi = session.mandateIndices[sid];
        const mandate = s.mandateSessions[mi];
        if (!mandate) return true;
        if (mandate.groupSize === 1) return false;
        const max = mandate.groupFlexible ? 3 : mandate.groupSize;
        return newSize <= max;
      });

      if (!allAllow) continue;

      // Check if the dragged student's mandate allows this group size
      const student = studentMap.get(studentId);
      if (student) {
        const mandate = student.mandateSessions[mandateIndex];
        if (mandate && mandate.groupSize === 1) continue;
        if (mandate && !mandate.groupFlexible && newSize > mandate.groupSize) continue;
      }

      // Merge into existing session
      addStudentToSession(session.id, studentId, mandateIndex);
      useAppStore.getState(); // ensure state is up to date
      // Lock the session
      const store = useAppStore.getState();
      const updatedSession = store.sessions.find((s) => s.id === session.id);
      if (updatedSession) {
        useAppStore.getState().updateSession(session.id, { locked: true });
      }
      merged = true;
      break;
    }

    if (!merged) {
      // Create a new individual session
      const endTime = startTime + duration;
      const newSession: ScheduledSession = {
        id: nextSessionId(),
        day,
        startTime,
        endTime,
        studentIds: [studentId],
        mandateIndices: { [studentId]: mandateIndex },
        type: 'individual',
        locked: true,
      };
      addSession(newSession);
    }

    // Remove from source if grid-to-grid drag
    if (sourceSessionId) {
      removeStudentFromSession(sourceSessionId, studentId);
    }

    // Re-validate
    revalidate();
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex">
        {/* Sidebar: Student list */}
        <div className="w-64 border-r border-gray-200 bg-white flex flex-col shrink-0">
          <StudentList />
          <ValidationPanel />
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {sessions.length} sessions
              </span>
              {errorCount > 0 && (
                <span className="text-xs text-red-600 font-medium" title="Check the validation panel in the sidebar for details">
                  {errorCount} error{errorCount !== 1 ? 's' : ''}
                </span>
              )}
              <ColorKey />
              <button
                onClick={() => setShowOtherProviders(!showOtherProviders)}
                className={`text-sm px-2 py-0.5 rounded border transition-colors ${
                  showOtherProviders
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                    : 'bg-gray-100 border-gray-300 text-gray-500'
                }`}
              >
                Other Providers
              </button>
              {excludedStudents.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  Hidden:
                  {excludedStudents.map((es) => (
                    <button
                      key={es.id}
                      onClick={() => toggleExcludedStudent(es.id)}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-colors"
                      title={`Restore ${es.label} to overlay`}
                    >
                      {es.label} <span className="text-green-500">+</span>
                    </button>
                  ))}
                </span>
              )}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="text-sm text-indigo-600 hover:text-indigo-700"
              >
                {showSettings ? 'Hide Settings' : 'Settings'}
              </button>
            </div>
            <button
              onClick={() => setStep('export')}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Export
            </button>
          </div>

          {showSettings && <SettingsPanel />}

          {/* Grid */}
          <div className="flex-1 overflow-hidden">
            <WeeklyGrid
              activeDrag={activeDrag}
              onRemoveStudent={handleRemoveStudent}
            />
          </div>
        </div>
      </div>

      <DragOverlay>
        {dragOverlayLabel ? (
          <div className="bg-indigo-100 border border-indigo-300 rounded px-3 py-1 text-xs font-medium text-indigo-800 shadow-lg">
            {dragOverlayLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
