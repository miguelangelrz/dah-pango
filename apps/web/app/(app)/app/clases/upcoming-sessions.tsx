'use client';

import type { StudentSession } from '@dah-pango/contracts';
import { ATTENDANCE_LABELS, type AttendanceState } from '@dah-pango/domain';
import { useState } from 'react';
import { FormError } from '@/components/form';
import { ProgramStripe } from '@/components/page-shell';
import { postJson } from '@/lib/api';
import { formatMoment, formatTime } from '@/lib/format';

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

export function UpcomingSessions({ initial }: { initial: StudentSession[] }) {
  const [sessions, setSessions] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function notify(id: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await postJson<StudentSession>(`/student/sessions/${id}/notice`, { note: note.trim() || undefined });
      setSessions((list) => list.map((s) => (s.id === id ? updated : s)));
      setOpen(null);
      setNote('');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (sessions.length === 0) return <p className="text-sm text-mute">No tienes sesiones en las próximas dos semanas.</p>;

  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li key={s.id} className="rounded-box border border-base-300 bg-base-200 p-4">
          <div className="flex items-stretch gap-3">
            <ProgramStripe color={s.program?.accentColor} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-mute first-letter:uppercase">
                {formatMoment(s.startsAt)} – {formatTime(s.endsAt)}
              </p>
              <p className="truncate font-semibold">{s.course.title}</p>
              <p className="text-sm text-mute">
                {s.program?.name ?? 'Clase general'} · {s.teacherName}
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
          {!s.canNotify && s.state === null && s.status === 'scheduled' && s.origin === 'enrolled' && (
            <p className="mt-2 text-xs text-mute">El aviso por la app ya cerró (24 horas antes). Si no puedes ir, avísale a tu profe.</p>
          )}
          {open === s.id && (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="text-sm font-medium">¿Quieres dejar un mensaje? (opcional)</span>
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
  );
}
