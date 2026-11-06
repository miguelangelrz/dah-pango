import type { AdminTerm } from '@dah-pango/contracts';
import { bogotaDate } from '@dah-pango/domain';
import Link from 'next/link';
import { formatRange } from '@/lib/format';
import { apiGet } from '@/lib/session';
import { NewTermForm } from './new-term-form';

export default async function TermsPage() {
  const terms = (await apiGet<AdminTerm[]>('/admin/terms')) ?? [];
  const today = bogotaDate(new Date());

  return (
    <div className="space-y-6">
      <p className="text-sm text-mute">
        Cada semestre se divide en bloques de 4 semanas desde su inicio, con las mismas fechas para
        toda la academia. Al crear un semestre se generan las sesiones de todas las clases semanales.
      </p>
      <ul className="space-y-3">
        {terms.map((t) => {
          const status =
            today < t.startsOn ? 'Próximo' : today > t.endsOn ? 'Terminado' : 'En curso';
          return (
            <li key={t.id}>
              <Link
                href={`/app/configuracion/semestres/${t.id}`}
                className="card card-border border-base-300 bg-base-200 transition hover:border-primary"
              >
                <div className="card-body gap-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">{t.name}</h2>
                    <span
                      className={`badge badge-sm ${status === 'En curso' ? 'badge-primary' : 'badge-ghost'}`}
                    >
                      {status}
                    </span>
                  </div>
                  <p className="text-sm">{formatRange(t.startsOn, t.endsOn)}</p>
                  <p className="text-xs text-mute">
                    {t.blocks.length} bloques · {t.sessionCount} sesiones
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
        {terms.length === 0 && <li className="text-mute">Todavía no hay semestres.</li>}
      </ul>
      <NewTermForm />
    </div>
  );
}
