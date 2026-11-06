import type { AttendanceDay } from '@dah-pango/contracts';
import { addDays, bogotaDate, isSuperAdmin } from '@dah-pango/domain';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDayLong } from '@/lib/format';
import { apiGet, getMe } from '@/lib/session';
import { SessionCard } from './session-card';

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const { fecha } = await searchParams;
  const me = await getMe();
  if (!me) redirect('/ingresar');
  const day = await apiGet<AttendanceDay>(`/attendance/day${fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''}`);
  if (!day) redirect('/app');
  const everyone = isSuperAdmin(me.roles);
  const today = bogotaDate(new Date());
  const label = day.date === today ? 'Hoy' : day.date === addDays(today, -1) ? 'Ayer' : day.date === addDays(today, 1) ? 'Mañana' : null;

  return (
    <>
      <header className="flex items-center justify-between">
        <Link href="/app" className="font-display text-2xl tracking-wide">
          DAH PANGO
        </Link>
        <Link href="/app" className="btn btn-ghost btn-sm rounded-full">
          Volver
        </Link>
      </header>
      <h1 className="mt-8 font-display text-5xl leading-none uppercase">Asistencia</h1>
      <p className="mt-2 text-sm text-mute">
        {everyone ? 'Todas las sesiones de la academia.' : 'Tus sesiones.'} La lista se cierra 24 horas después de
        cada clase: quien no tenga marca queda con Falta.
      </p>

      {day.pending.length > 0 && (
        <section className="mt-8 space-y-3">
          <h2 className="font-display text-2xl text-primary uppercase">Por completar</h2>
          <ul className="space-y-2">
            {day.pending.map((s) => (
              <li key={s.id}>
                <SessionCard s={s} showDay showTeacher={everyone} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="mt-8 flex items-center justify-between gap-2" aria-label="Cambiar de día">
        <Link href={`/app/asistencia?fecha=${addDays(day.date, -1)}`} className="btn btn-circle btn-ghost" aria-label="Día anterior">
          ‹
        </Link>
        <div className="text-center">
          <p className="font-display text-2xl uppercase">{label ?? formatDayLong(day.date)}</p>
          {label && <p className="text-sm text-mute first-letter:uppercase">{formatDayLong(day.date)}</p>}
        </div>
        <Link href={`/app/asistencia?fecha=${addDays(day.date, 1)}`} className="btn btn-circle btn-ghost" aria-label="Día siguiente">
          ›
        </Link>
      </nav>
      {day.date !== today && (
        <Link href="/app/asistencia" className="link mx-auto mt-1 text-sm text-mute">
          Volver a hoy
        </Link>
      )}

      <ul className="mt-4 space-y-2">
        {day.sessions.map((s) => (
          <li key={s.id}>
            <SessionCard s={s} showTeacher={everyone} />
          </li>
        ))}
      </ul>
      {day.sessions.length === 0 && <p className="mt-4 text-center text-mute">No hay sesiones este día.</p>}
    </>
  );
}
