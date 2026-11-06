'use client';

import type { AdminCourse, SessionSyncSummary } from '@dah-pango/contracts';
import { slotFromDuration, slotsProblem, WEEKDAY_LABELS, type WeeklySlot } from '@dah-pango/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/form';
import { putJson } from '@/lib/api';
import { describeSync, formatDuration } from '@/lib/format';

interface Row {
  weekday: number;
  startsAt: string;
  durationMinutes: number;
}

const DURATIONS = [45, 60, 75, 90, 120, 150, 180];

export function SlotsEditor({ course }: { course: AdminCourse }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    course.slots.map(({ weekday, startsAt, durationMinutes }) => ({ weekday, startsAt, durationMinutes })),
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slots = rows.map((r) => (r.startsAt ? slotFromDuration(r.weekday, r.startsAt, r.durationMinutes) : null));
  const problem = slots.some((s) => s === null)
    ? 'Revisa las horas: cada clase necesita una hora de inicio y debe terminar antes de la medianoche'
    : slotsProblem(slots as WeeklySlot[]);

  function change(i: number, patch: Partial<Row>) {
    setDone(null);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (rows.length === 0 && !confirm('La clase queda sin horario y se quitan sus sesiones que vienen. ¿Seguimos?')) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { sessions } = await putJson<{ sessions: SessionSyncSummary }>(`/admin/courses/${course.id}/slots`, {
        slots: rows,
      });
      setDone(`Horario guardado. ${describeSync(sessions)}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {rows.map((r, i) => {
          const slot = slots[i];
          const durations = DURATIONS.includes(r.durationMinutes) ? DURATIONS : [...DURATIONS, r.durationMinutes].sort((a, b) => a - b);
          return (
            <li key={i} className="rounded-box border border-base-300 bg-base-200 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="col-span-2 block sm:col-span-1">
                  <span className="text-xs text-mute">Día</span>
                  <select
                    className="select mt-1 w-full bg-base-100"
                    value={r.weekday}
                    onChange={(e) => change(i, { weekday: Number(e.target.value) })}
                  >
                    {WEEKDAY_LABELS.map((label, d) => (
                      <option key={label} value={d + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-mute">Empieza</span>
                  <input
                    type="time"
                    step={300}
                    className="input mt-1 w-full bg-base-100"
                    value={r.startsAt}
                    onChange={(e) => change(i, { startsAt: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-mute">Duración</span>
                  <select
                    className="select mt-1 w-full bg-base-100"
                    value={r.durationMinutes}
                    onChange={(e) => change(i, { durationMinutes: Number(e.target.value) })}
                  >
                    {durations.map((m) => (
                      <option key={m} value={m}>
                        {formatDuration(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-mute">{slot ? `Termina a las ${slot.endsAt}` : ''}</span>
                <button
                  type="button"
                  onClick={() => {
                    setDone(null);
                    setRows(rows.filter((_, j) => j !== i));
                  }}
                  className="btn btn-ghost btn-xs rounded-full"
                >
                  Quitar
                </button>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-mute">Esta clase no tiene horario.</li>}
      </ul>
      <button
        type="button"
        onClick={() => {
          setDone(null);
          const last = rows.at(-1);
          setRows([...rows, last ? { ...last, weekday: (last.weekday % 7) + 1 } : { weekday: 1, startsAt: '18:00', durationMinutes: 60 }]);
        }}
        className="btn btn-outline btn-sm rounded-full"
      >
        Agregar día
      </button>
      <FormError message={error ?? problem} />
      {done && (
        <p role="status" className="alert alert-success alert-soft text-sm">
          {done}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={busy || problem !== null}
        className="btn btn-primary btn-lg btn-block rounded-full font-display text-xl tracking-wide uppercase"
      >
        {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Guardar horario'}
      </button>
    </div>
  );
}
