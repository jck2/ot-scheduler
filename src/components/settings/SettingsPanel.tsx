import { useAppStore } from '@/store/useAppStore';
import { ALL_DAYS } from '@/utils/constants';
import { generateSchedule } from '@/scheduling/algorithm';
import { validateSchedule } from '@/scheduling/validator';
import type { DayOfWeek } from '@/types';

function minutesToInputValue(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function inputValueToMinutes(value: string): number | null {
  const [h, m] = value.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function SettingsPanel() {
  const config = useAppStore((s) => s.config);
  const students = useAppStore((s) => s.students);
  const conflicts = useAppStore((s) => s.conflicts);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setSessions = useAppStore((s) => s.setSessions);
  const setValidationErrors = useAppStore((s) => s.setValidationErrors);

  function toggleDay(day: DayOfWeek) {
    const days = config.activeDays.includes(day)
      ? config.activeDays.filter((d) => d !== day)
      : [...config.activeDays, day];
    updateConfig({ activeDays: days });
  }

  function handleStartTime(value: string) {
    const mins = inputValueToMinutes(value);
    if (mins !== null) updateConfig({ startTime: mins });
  }

  function handleEndTime(value: string) {
    const mins = inputValueToMinutes(value);
    if (mins !== null) updateConfig({ endTime: mins });
  }

  function handlePreferredEnd(value: string) {
    const mins = inputValueToMinutes(value);
    if (mins !== null) updateConfig({ preferredEndTime: mins });
  }

  function handleLunchStart(value: string) {
    const mins = inputValueToMinutes(value);
    if (mins !== null) updateConfig({ lunchStart: mins });
  }

  function handleLunchEnd(value: string) {
    const mins = inputValueToMinutes(value);
    if (mins !== null) updateConfig({ lunchEnd: mins });
  }

  function handleRegenerate() {
    const currentConfig = useAppStore.getState().config;
    const sessions = generateSchedule(students, conflicts, currentConfig);
    setSessions(sessions);
    const errors = validateSchedule(sessions, students, conflicts, currentConfig);
    setValidationErrors(errors);
  }

  return (
    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-600 font-medium">Days:</span>
        {ALL_DAYS.map((day) => (
          <label key={day} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={config.activeDays.includes(day)}
              onChange={() => toggleDay(day)}
              className="rounded text-indigo-600"
            />
            <span className="text-gray-700">{day.slice(0, 3)}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-600 font-medium" title="Earliest available slot">Start:</span>
        <input
          type="time"
          value={minutesToInputValue(config.startTime)}
          onChange={(e) => handleStartTime(e.target.value)}
          step="1800"
          className="px-2 py-0.5 border border-gray-300 rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-600 font-medium" title="Prefer to end by this time">Prefer end:</span>
        <input
          type="time"
          value={minutesToInputValue(config.preferredEndTime)}
          onChange={(e) => handlePreferredEnd(e.target.value)}
          step="1800"
          className="px-2 py-0.5 border border-gray-300 rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-600 font-medium" title="Absolute latest — no sessions after this">Hard end:</span>
        <input
          type="time"
          value={minutesToInputValue(config.endTime)}
          onChange={(e) => handleEndTime(e.target.value)}
          step="1800"
          className="px-2 py-0.5 border border-gray-300 rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-600 font-medium">Lunch:</span>
        <input
          type="time"
          value={minutesToInputValue(config.lunchStart)}
          onChange={(e) => handleLunchStart(e.target.value)}
          step="1800"
          className="px-2 py-0.5 border border-gray-300 rounded text-sm w-24"
        />
        <span className="text-gray-400">to</span>
        <input
          type="time"
          value={minutesToInputValue(config.lunchEnd)}
          onChange={(e) => handleLunchEnd(e.target.value)}
          step="1800"
          className="px-2 py-0.5 border border-gray-300 rounded text-sm w-24"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-600 font-medium">Term Start:</label>
        <input
          type="date"
          value={config.termStartDate ?? ''}
          onChange={(e) => updateConfig({ termStartDate: e.target.value })}
          className="px-2 py-0.5 border border-gray-300 rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-600 font-medium">Term End:</label>
        <input
          type="date"
          value={config.termEndDate ?? ''}
          onChange={(e) => updateConfig({ termEndDate: e.target.value })}
          className="px-2 py-0.5 border border-gray-300 rounded text-sm"
        />
      </div>
      <button
        onClick={handleRegenerate}
        className="px-3 py-1 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors"
        title="Regenerate the schedule with current settings"
      >
        Regenerate Schedule
      </button>
    </div>
  );
}
