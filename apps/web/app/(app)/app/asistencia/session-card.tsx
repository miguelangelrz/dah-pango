import type { AttendanceSessionSummary } from '@dah-pango/contracts';
import Link from 'next/link';
import { formatMoment, formatTime } from '@/lib/format';

/** One sesión in a list: time, clase, teacher and how much of the list is marked. */
export function SessionCard({ s, showDay = false, showTeacher }: { s: AttendanceSessionSummary; showDay?: boolean; showTeacher: boolean }) {
  const complete = s.counts.listed > 0 && s.counts.marked === s.counts.listed;
  return (
    <Link
      href={`/app/asistencia/${s.id}`}
      className="flex items-stretch gap-3 rounded-box border border-base-300 bg-base-200 p-4 transition hover:border-primary"
    >
      <span aria-hidden className="w-1 shrink-0 rounded-full" style={{ background: s.program?.accentColor ?? 'var(--color-chalk)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-mute">
          {showDay ? formatMoment(s.startsAt) : formatTime(s.startsAt)} – {formatTime(s.endsAt)}
          {s.program ? ` · ${s.program.name}` : ' · Clase general'}
        </p>
        <p className="truncate font-semibold">{s.course.title}</p>
        {showTeacher && (
          <p className="text-sm text-mute">
            {s.mine ? 'Tú' : s.teacher.fullName}
            {!s.teacher.hasAccount && ' (invitado: la toma dirección)'}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center gap-1">
        {s.status === 'cancelled' ? (
          <span className="badge badge-ghost">Cancelada</span>
        ) : s.status === 'rescheduled' ? (
          <span className="badge badge-ghost">Reprogramada</span>
        ) : (
          <>
            <span className={`badge ${complete ? 'badge-success' : s.counts.marked > 0 ? 'badge-primary' : 'badge-ghost'}`}>
              {s.counts.marked}/{s.counts.listed}
            </span>
            {s.locked && <span className="text-xs text-mute">Cerrada</span>}
          </>
        )}
      </div>
    </Link>
  );
}
