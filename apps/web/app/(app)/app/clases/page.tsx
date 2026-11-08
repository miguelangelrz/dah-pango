import type { StudentHome } from '@dah-pango/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageShell, ProgramStripe } from '@/components/page-shell';
import { formatDate, formatMoment, formatRange, formatSlots, formatTime } from '@/lib/format';
import { apiGet } from '@/lib/session';
import { StateBadge, UpcomingSessions } from './upcoming-sessions';

export default async function MyClassesPage() {
  const home = await apiGet<StudentHome>('/student/home');
  if (!home) redirect('/app');

  return (
    <PageShell
      title="Mis clases"
      intro={home.term ? `${home.term.name} · ${formatRange(home.term.startsOn, home.term.endsOn)}` : 'Todavía no hay semestre.'}
    >
      <section aria-labelledby="balances" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="balances" className="font-display text-2xl uppercase">
            Reposiciones
          </h2>
          <Link href="/app/solicitudes?tipo=reposicion" className="btn btn-primary btn-sm rounded-full">
            Pedir reposición
          </Link>
        </div>
        {home.balances.length === 0 ? (
          <p className="text-sm text-mute">Cuando avises una falta a tiempo, aquí aparece tu reposición a favor.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {home.balances.map((b) => (
              <li key={b.program.id} className="flex gap-3 rounded-box border border-base-300 bg-base-200 p-4">
                <ProgramStripe color={b.program.accentColor} />
                <div>
                  <p className="text-sm text-mute">{b.program.name}</p>
                  <p className={`font-display text-4xl leading-none ${b.balance < 0 ? 'text-error' : ''}`}>{b.balance}</p>
                  <p className="text-xs text-mute">
                    {b.balance > 0 ? 'a favor' : b.balance < 0 ? 'por reponer en tu contra' : 'sin reposiciones'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-mute">
          Las reposiciones son en tu mismo programa o en una clase general, y no vencen.
        </p>
      </section>

      <section aria-labelledby="upcoming" className="mt-10 space-y-3">
        <h2 id="upcoming" className="font-display text-2xl uppercase">
          Próximas sesiones
        </h2>
        <p className="text-sm text-mute">
          Si no puedes ir, avisa hasta 24 horas antes y ganas una reposición. Después de eso, habla con tu profe.
        </p>
        <UpcomingSessions initial={home.upcoming} />
      </section>

      <section aria-labelledby="enrollments" className="mt-10 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="enrollments" className="font-display text-2xl uppercase">
            Inscripciones
          </h2>
          <Link href="/app/solicitudes" className="btn btn-ghost btn-sm rounded-full">
            {home.pendingRequests > 0 ? `Solicitudes (${home.pendingRequests})` : 'Solicitudes'}
          </Link>
        </div>
        {home.enrollments.length === 0 && (
          <p className="text-sm text-mute">
            No tienes inscripciones en este semestre.{' '}
            <Link href="/app/solicitudes?tipo=inscripcion" className="link">
              Pide una
            </Link>
            .
          </p>
        )}
        <ul className="space-y-2">
          {home.enrollments.map((e) => (
            <li key={e.id} className="flex gap-3 rounded-box border border-base-300 bg-base-200 p-4">
              <ProgramStripe color={e.program?.accentColor} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-mute">
                  {e.target.kind === 'track' ? 'Línea' : 'Clase'} · {e.program?.name ?? 'Clase general'}
                </p>
                <p className="font-semibold">{e.target.name}</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {e.courses.map((c) => (
                    <li key={c.id}>
                      {e.target.kind === 'track' && <span className="font-medium">{c.title}: </span>}
                      <span className="text-mute">{formatSlots(c.slots)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-mute">
                  Desde el {formatDate(e.validFrom)} hasta el {formatDate(e.validTo)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="history" className="mt-10 space-y-3">
        <h2 id="history" className="font-display text-2xl uppercase">
          Historial
        </h2>
        {home.history.length === 0 && <p className="text-sm text-mute">Todavía no hay sesiones pasadas.</p>}
        {home.history.length > 0 && <HistorySummary history={home.history} />}
        <HistoryList sessions={home.history.slice(0, RECENT)} />
        {home.history.length > RECENT && (
          <details className="group">
            <summary className="btn btn-ghost btn-sm cursor-pointer rounded-full group-open:hidden">
              Ver todo el historial ({home.history.length})
            </summary>
            <div className="mt-2">
              <HistoryList sessions={home.history.slice(RECENT)} />
            </div>
          </details>
        )}
      </section>
    </PageShell>
  );
}

const RECENT = 8;

function HistorySummary({ history }: { history: StudentHome['history'] }) {
  const count = (state: string) => history.filter((s) => s.state === state).length;
  const parts = [
    [count('present') + count('makeup'), 'asistencias'],
    [count('excused'), 'faltas con aviso'],
    [count('absent'), 'faltas'],
  ].filter(([n]) => Number(n) > 0);
  return <p className="text-sm text-mute">Este semestre: {parts.map(([n, label]) => `${n} ${label}`).join(' · ')}.</p>;
}

function HistoryList({ sessions }: { sessions: StudentHome['history'] }) {
  if (sessions.length === 0) return null;
  return (
    <ul className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-200">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{s.course.title}</p>
            <p className="text-xs text-mute">
              {formatMoment(s.startsAt)} – {formatTime(s.endsAt)}
              {s.origin === 'makeup' && ' · Reposición'}
            </p>
          </div>
          <StateBadge s={s} />
        </li>
      ))}
    </ul>
  );
}
