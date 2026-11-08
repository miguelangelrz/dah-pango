import type { RequestView } from '@dah-pango/contracts';
import { ENROLLMENT_ACTION_LABELS, REQUEST_STATUS_LABELS, type RequestStatus } from '@dah-pango/domain';
import { formatDate, formatMoment, formatTime } from '@/lib/format';

const STATUS_BADGE: Record<RequestStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-success',
  denied: 'badge-error',
  withdrawn: 'badge-ghost',
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge badge-soft shrink-0 ${STATUS_BADGE[status]}`}>{REQUEST_STATUS_LABELS[status]}</span>;
}

export function requestTitle(r: RequestView): string {
  if (r.kind === 'makeup') return `Reposición en ${r.session.title}`;
  if (r.action === 'leave') return `Salida de ${r.replaces?.name ?? 'una inscripción'}`;
  if (r.action === 'swap') return `Cambio de ${r.replaces?.name ?? '…'} a ${r.target?.name ?? '…'}`;
  return `${ENROLLMENT_ACTION_LABELS.join} en ${r.target?.name ?? '…'}`;
}

/** The details of a request, as both the student and the director see them. */
export function RequestDetails({ r }: { r: RequestView }) {
  return (
    <div className="space-y-1 text-sm">
      {r.kind === 'makeup' ? (
        <>
          <p className="text-mute first-letter:uppercase">
            {formatMoment(r.session.startsAt)} – {formatTime(r.session.endsAt)} · {r.session.program?.name ?? 'Clase general'}
          </p>
          <p className="text-mute">
            Cuenta en {r.program.name}. Saldo: <span className={r.balance < 0 ? 'text-error' : ''}>{r.balance}</span>
          </p>
        </>
      ) : (
        <>
          {r.target && (
            <p className="text-mute">
              {r.target.kind === 'track' ? 'Línea' : 'Clase'} · {r.target.program?.name ?? 'Clase general'}
            </p>
          )}
          <p className="text-mute">
            {r.action === 'leave' ? 'Deja de ir desde el' : 'Desde el'}{' '}
            {formatDate(r.approvedStart ?? r.wantedStart ?? r.createdAt.slice(0, 10))}
            {r.approvedStart && r.wantedStart && r.approvedStart !== r.wantedStart && ` (pidió el ${formatDate(r.wantedStart)})`}
          </p>
          {r.clashes.length > 0 && <p className="text-error">Se cruza en horario con {r.clashes.join(', ')}</p>}
        </>
      )}
      {r.note && <p className="italic">“{r.note}”</p>}
      {r.reply && (
        <p>
          <span className="font-medium">Respuesta{r.reviewedBy ? ` de ${r.reviewedBy}` : ''}:</span> {r.reply}
        </p>
      )}
    </div>
  );
}
