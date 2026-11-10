'use client';

import type { StudentDay, StudentSession } from '@dah-pango/contracts';
import { ATTENDANCE_LABELS, type AttendanceState } from '@dah-pango/domain';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/form';
import { ProgramStripe } from '@/components/page-shell';
import { postJson } from '@/lib/api';
import { formatDayLong, formatTime } from '@/lib/format';

const BADGE: Record<AttendanceState, string> = {
  present: 'badge-success',
  absent: 'badge-error',
  excused: 'badge-warning',
  makeup: 'badge-info',
};

/** The student's mark on a sesión, or what's going on with it. */
export function StateBadge({ s }: { s: StudentSession }) {
  if (s.status === 'cancelled') return <span className="badge badge-ghost shrink-0">Cancelada</span>;
  if (s.status === 'rescheduled') return <span className="badge badge-ghost shrink-0">Reprogramada</span>;
  if (s.state) {
    const label = s.state === 'excused' && s.noticeSent ? 'Avisaste' : ATTENDANCE_LABELS[s.state];
    return <span className={`badge badge-soft shrink-0 ${BADGE[s.state]}`}>{label}</span>;
  }
  if (s.origin === 'makeup') return <span className="badge badge-info badge-soft shrink-0">Reposición</span>;
  // Upcoming sesiones have no mark yet; past ones wait for the teacher until the lock.
  return s.locked || new Date(s.startsAt) > new Date() ? null : <span className="badge badge-ghost shrink-0">Sin marcar</span>;
}

/** 'Hoy', 'Mañana' or 'Ayer' for days near today, else null. */
function nearDay(date: string, today: string): string | null {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : diff === -1 ? 'Ayer' : null;
}

/** Days with clases, each under its own heading, with "No voy" as a quick action. */
export function ClassDays({ initial, today }: { initial: StudentDay[]; today: string }) {
  const [days, setDays] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new page of days arrives as new props when the student moves between dates.
  useEffect(() => setDays(initial), [initial]);

  async function notify(id: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await postJson<StudentSession>(`/student/sessions/${id}/notice`, { note: note.trim() || undefined });
      setDays((list) => list.map((d) => ({ ...d, sessions: d.sessions.map((s) => (s.id === id ? updated : s)) })));
      setOpen(null);
      setNote('');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (days.length === 0) return <p className="py-6 text-center text-mute">No tienes clases programadas desde esta fecha.</p>;

  return (
    <div className="space-y-6">
      {days.map((day) => {
        const near = nearDay(day.date, today);
        return (
          <section key={day.date} aria-label={formatDayLong(day.date)} className="space-y-2">
            <h3 className="flex items-baseline gap-2 border-b border-base-300 pb-1">
              {near && <span className="font-display text-xl text-primary uppercase">{near}</span>}
              <span className={`first-letter:uppercase ${near ? 'text-sm text-mute' : 'font-display text-xl uppercase'}`}>
                {formatDayLong(day.date)}
              </span>
            </h3>
            <ul className="space-y-2">
              {day.sessions.map((s) => (
                <li key={s.id} className="rounded-box border border-base-300 bg-base-200 p-4">
                  <div className="flex items-stretch gap-3">
                    <ProgramStripe color={s.program?.accentColor} />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-2xl leading-none">{formatTime(s.startsAt)}</p>
                      <p className="mt-1 truncate font-semibold">{s.course.title}</p>
                      <p className="text-sm text-mute">
                        hasta {formatTime(s.endsAt)} · {s.teacherName}
                        {s.modality === 'online' ? ' · En línea' : s.room ? ` · ${s.room}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end justify-center gap-2">
                      <StateBadge s={s} />
                      {s.canNotify && open !== s.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(s.id);
                            setError(null);
                          }}
                          className="btn btn-outline btn-sm rounded-full"
                        >
                          No voy
                        </button>
                      )}
                    </div>
                  </div>
                  {open === s.id && (
                    <div className="mt-3 space-y-2 border-t border-base-300 pt-3">
                      <p className="text-sm">Le avisamos a tu profe y ganas una reposición.</p>
                      <label className="block">
                        <span className="text-sm text-mute">Mensaje (opcional)</span>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          maxLength={500}
                          rows={2}
                          className="textarea mt-1 w-full bg-base-100"
                        />
                      </label>
                      <FormError message={error} />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => notify(s.id)} className="btn btn-primary flex-1 rounded-full">
                          {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Avisar que no voy'}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setOpen(null)} className="btn btn-ghost rounded-full">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
