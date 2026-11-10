import type { StudentHome } from '@dah-pango/contracts';
import { bogotaDate } from '@dah-pango/domain';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { formatDate, formatMoment, formatTime } from '@/lib/format';
import { apiGet } from '@/lib/session';
import { ClassDays, StateBadge } from './class-days';

/** History rows shown before "Ver todo". */
const RECENT = 8;

export default async function MyClassesPage({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
  const { desde } = await searchParams;
  const home = await apiGet<StudentHome>(`/student/home${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`);
  if (!home) redirect('/app');
  const today = bogotaDate(new Date());
  const withBalance = home.balances.filter((b) => b.balance !== 0);

  return (
    <PageShell title="Mis clases">
      {withBalance.length > 0 && (
        <p className="-mt-3 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
          <span>Reposiciones:</span>
          {withBalance.map((b) => (
            <span key={b.program.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: b.program.accentColor ?? 'var(--color-chalk)' }} />
              {b.program.name} <span className={`font-semibold ${b.balance < 0 ? 'text-error' : 'text-base-content'}`}>{b.balance}</span>
            </span>
          ))}
        </p>
      )}

      <section aria-labelledby="next" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="next" className="font-display text-3xl uppercase">
            Próximas clases
          </h2>
          <nav className="flex items-center gap-1" aria-label="Moverse entre fechas">
            {home.prevFrom ? (
              <Link href={`/app/clases?desde=${home.prevFrom}`} className="btn btn-circle btn-ghost btn-sm" aria-label="Clases anteriores">
                ‹
              </Link>
            ) : (
              <span className="btn btn-circle btn-ghost btn-sm btn-disabled" aria-hidden>
                ‹
              </span>
            )}
            {home.nextFrom ? (
              <Link href={`/app/clases?desde=${home.nextFrom}`} className="btn btn-circle btn-ghost btn-sm" aria-label="Clases siguientes">
                ›
              </Link>
            ) : (
              <span className="btn btn-circle btn-ghost btn-sm btn-disabled" aria-hidden>
                ›
              </span>
            )}
          </nav>
        </div>
        {home.from !== today && (
          <p className="-mt-2 text-sm text-mute">
            Desde el {formatDate(home.from)} ·{' '}
            <Link href="/app/clases" className="link">
              Volver a hoy
            </Link>
          </p>
        )}
        <ClassDays initial={home.days} today={today} />
        <p className="text-xs text-mute">
          ¿No puedes ir? Toca «No voy» hasta 24 horas antes y ganas una reposición. Después de eso, avísale a tu profe.
        </p>
      </section>

      <section aria-labelledby="history" className="mt-12 space-y-3">
        <h2 id="history" className="font-display text-3xl uppercase">
          Historial
        </h2>
        {home.history.length === 0 ? (
          <p className="text-sm text-mute">Todavía no hay clases pasadas este semestre.</p>
        ) : (
          <HistorySummary history={home.history} />
        )}
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

function HistorySummary({ history }: { history: StudentHome['history'] }) {
  const count = (states: string[]) => history.filter((s) => s.state && states.includes(s.state)).length;
  const parts = [
    [count(['present', 'makeup']), 'asistencias'],
    [count(['excused']), 'faltas con aviso'],
    [count(['absent']), 'faltas'],
  ].filter(([n]) => Number(n) > 0);
  if (parts.length === 0) return null;
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
