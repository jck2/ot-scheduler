import { useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { minutesToTime } from '@/utils/timeUtils';
import type { CellSet, DayOfWeek, Student } from '@/types';

type Brush = 'allow' | 'block' | 'erase';

const DAY_ABBR: Record<DayOfWeek, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
};

function cloneSet(set: CellSet | undefined): CellSet {
  const out: CellSet = {};
  if (set) for (const [day, starts] of Object.entries(set)) out[day as DayOfWeek] = [...(starts ?? [])];
  return out;
}

function setCell(set: CellSet, day: DayOfWeek, t: number, present: boolean): CellSet {
  const next = cloneSet(set);
  const starts = new Set(next[day] ?? []);
  if (present) starts.add(t);
  else starts.delete(t);
  if (starts.size) next[day] = [...starts].sort((a, b) => a - b);
  else delete next[day];
  return next;
}

/** Drop empty days; return undefined if nothing is painted. */
function prune(set: CellSet): CellSet | undefined {
  const out: CellSet = {};
  for (const [day, starts] of Object.entries(set)) {
    if (starts && starts.length) out[day as DayOfWeek] = [...starts].sort((a, b) => a - b);
  }
  return Object.keys(out).length ? out : undefined;
}

export function StudentRulesEditor({ student, onClose }: { student: Student; onClose: () => void }) {
  const config = useAppStore((s) => s.config);
  const existing = useAppStore((s) =>
    s.customRules.find((r) => r.studentId === student.osisNumber)
  );
  const setStudentRules = useAppStore((s) => s.setStudentRules);
  const removeStudentRules = useAppStore((s) => s.removeStudentRules);

  const [allow, setAllow] = useState<CellSet>(() => cloneSet(existing?.allow));
  const [block, setBlock] = useState<CellSet>(() => cloneSet(existing?.block));
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [note, setNote] = useState(existing?.note ?? '');
  const [brush, setBrush] = useState<Brush>('block');
  const painting = useRef(false);

  const days = config.activeDays;
  const times: number[] = [];
  for (let t = config.startTime; t + config.slotDuration <= config.endTime; t += config.slotDuration) {
    times.push(t);
  }

  function paint(day: DayOfWeek, t: number) {
    setAllow((prev) => setCell(prev, day, t, brush === 'allow'));
    setBlock((prev) => setCell(prev, day, t, brush === 'block'));
  }

  function cellState(day: DayOfWeek, t: number): Brush | 'none' {
    if (block[day]?.includes(t)) return 'block';
    if (allow[day]?.includes(t)) return 'allow';
    return 'none';
  }

  function handleSave() {
    const a = prune(allow);
    const b = prune(block);
    if (!a && !b) {
      removeStudentRules(student.osisNumber);
    } else {
      setStudentRules(student.osisNumber, { allow: a, block: b, note: note.trim() || undefined, enabled });
    }
    onClose();
  }

  function handleClear() {
    setAllow({});
    setBlock({});
    setNote('');
  }

  const hasAllow = Object.values(allow).some((v) => v && v.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">
            Availability rules — {student.firstName} {student.lastName}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Paint cells to say when this student can or can&apos;t be seen. These are saved on
            this device and survive re-importing the sheets.
          </p>
        </div>

        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-gray-100 text-xs">
          <span className="text-gray-500">Brush:</span>
          {(['block', 'allow', 'erase'] as Brush[]).map((b) => (
            <button
              key={b}
              onClick={() => setBrush(b)}
              className={`px-2 py-1 rounded border ${
                brush === b ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-gray-200'
              } ${b === 'allow' ? 'bg-green-100 text-green-800' : b === 'block' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}
            >
              {b === 'allow' ? 'Allow only' : b === 'block' ? 'Block' : 'Erase'}
            </button>
          ))}
          <span className="ml-auto text-gray-400">
            {hasAllow ? 'Green = the ONLY times allowed' : 'Red = blocked times'}
          </span>
        </div>

        <div
          className="flex-1 overflow-auto p-4 select-none"
          onPointerUp={() => (painting.current = false)}
          onPointerLeave={() => (painting.current = false)}
        >
          <table className="border-collapse text-[11px] mx-auto">
            <thead>
              <tr>
                <th className="w-14" />
                {days.map((d) => (
                  <th key={d} className="px-1 py-1 text-gray-500 font-medium">
                    {DAY_ABBR[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t) => (
                <tr key={t}>
                  <td className="pr-2 text-right text-gray-400 whitespace-nowrap">
                    {minutesToTime(t)}
                  </td>
                  {days.map((d) => {
                    const st = cellState(d, t);
                    const bg =
                      st === 'allow'
                        ? 'bg-green-400'
                        : st === 'block'
                        ? 'bg-red-400'
                        : 'bg-gray-50 hover:bg-gray-200';
                    return (
                      <td key={d} className="p-0">
                        <div
                          role="button"
                          aria-label={`${d} ${minutesToTime(t)} ${st}`}
                          className={`w-14 h-5 border border-white cursor-pointer ${bg}`}
                          onPointerDown={() => {
                            painting.current = true;
                            paint(d, t);
                          }}
                          onPointerEnter={() => {
                            if (painting.current) paint(d, t);
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 space-y-3">
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span className="text-gray-700">Enabled</span>
            </label>
            <input
              type="text"
              placeholder="Optional note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div className="flex items-center justify-between">
            <button onClick={handleClear} className="text-xs text-gray-500 hover:text-red-600">
              Clear all
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
