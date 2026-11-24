'use client';

import type { StudentEnrollmentRequest } from '@dah-pango/contracts';
import { ENROLLMENT_ACTION_LABELS, REQUEST_STATUS_LABELS, type RequestStatus } from '@dah-pango/domain';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/form';
import { ProgramStripe } from '@/components/page-shell';
import { postJson } from '@/lib/api';
import { formatDayLong, formatMoment } from '@/lib/format';

const BADGE: Record<RequestStatus, string> = {
  pending: 'badge-warning badge-soft',
  approved: 'badge-success badge-soft',
  denied: 'badge-error badge-soft',
  withdrawn: 'badge-outline border-base-300 text-mute',
};

export function RequestList({ requests: initial }: { requests: StudentEnrollmentRequest[] }) {
  const [requests, setRequests] = useState(initial);
  useEffect(() => setRequests(initial), [initial]);

  const replace = (updated: StudentEnrollmentRequest) =>
    setRequests((list) => list.map((r) => (r.id === updated.id ? updated : r)));

  const pending = requests.filter((r) => r.status === 'pending');
  const answered = requests.filter((r) => r.status !== 'pending');

  if (requests.length === 0) {
    return (
      <div className="rounded-box border border-dashed border-base-300 p-6 text-center">
        <p className="text-mute">Todavía no has enviado solicitudes este semestre.</p>
        <Link href="/app/programas" className="btn btn-outline btn-sm mt-4 rounded-full">
          Ir a Mis programas
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Section
        title="Pendientes"
        count={pending.length}
        intro="Mientras el director las revisa, sigues en tus clases como están."
        empty="No tienes solicitudes esperando respuesta."
      >
        {pending.map((r) => (
          <RequestCard key={r.id} request={r} onWithdrawn={replace} />
        ))}
      </Section>
      {answered.length > 0 && (
        <Section title="Cerradas" count={answered.length}>
          {answered.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </Section>
      )}
      <p className="text-center text-sm text-mute">
        ¿Quieres agregar o cambiar una clase?{' '}
        <Link href="/app/programas" className="link link-primary">
          Ve a Mis programas
        </Link>
      </p>
    </div>
  );
}

function Section({
  title,
  count,
  intro,
  empty,
  children,
}: {
  title: string;
  count: number;
  intro?: string;
  empty?: string;
  children: React.ReactNode;
}) {
  const id = `requests-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="flex items-baseline gap-2 border-b border-base-300 pb-1">
        <span className="font-display text-3xl uppercase">{title}</span>
        <span className="ml-auto text-sm text-mute">{count}</span>
      </h2>
      {intro && count > 0 && <p className="text-sm text-mute">{intro}</p>}
      {count === 0 && empty ? <p className="text-sm text-mute">{empty}</p> : <ul className="space-y-2">{children}</ul>}
    </section>
  );
}

/** What the request asks for, in one line: 'Cambiar Funcional por Hip Hop'. */
function describe(r: StudentEnrollmentRequest): React.ReactNode {
  const course = <span className="font-semibold">{r.course?.title ?? 'una clase'}</span>;
  if (r.action === 'swap') {
    return (
      <>
        Cambiar <span className="font-semibold">{r.replacesCourse?.title ?? 'una clase'}</span> por {course}
      </>
    );
  }
  if (r.action === 'leave') return <>Cancelar <span className="font-semibold">{r.replacesCourse?.title ?? 'una clase'}</span></>;
  return <>Agregar {course}</>;
}

function RequestCard({
  request: r,
  onWithdrawn,
}: {
  request: StudentEnrollmentRequest;
  onWithdrawn?: (updated: StudentEnrollmentRequest) => void;
}) {
  return (
    <li className="rounded-box border border-base-300 bg-base-200">
      <div className="flex items-stretch gap-3 p-4">
        <ProgramStripe color={r.program?.accentColor} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0">
              <span className="sr-only">{ENROLLMENT_ACTION_LABELS[r.action]}: </span>
              {describe(r)}
            </p>
            <span className={`badge shrink-0 ${BADGE[r.status]}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
          </div>
          <p className="text-xs text-mute">
            {r.program?.name ?? 'Clases generales'} · Enviada el {formatMoment(r.createdAt)}
          </p>
          {r.note && <p className="text-sm text-mute italic">“{r.note}”</p>}
          <Answer request={r} />
        </div>
      </div>
      {r.status === 'pending' && onWithdrawn && <Withdraw request={r} onWithdrawn={onWithdrawn} />}
    </li>
  );
}

/** The director's answer, once there is one. */
function Answer({ request: r }: { request: StudentEnrollmentRequest }) {
  if (r.status === 'pending' || r.status === 'withdrawn') return null;
  return (
    <div className={`mt-2 space-y-1 rounded-field px-3 py-2 text-sm ${r.status === 'approved' ? 'bg-success/10' : 'bg-error/10'}`}>
      {r.status === 'approved' && r.approvedStart && <p className="font-semibold">Empieza el {formatDayLong(r.approvedStart)}</p>}
      {r.reply && <p>Director: “{r.reply}”</p>}
      {r.reviewedAt && (
        <p className="text-xs text-mute">
          {REQUEST_STATUS_LABELS[r.status]} el {formatMoment(r.reviewedAt)}
        </p>
      )}
    </div>
  );
}

function Withdraw({
  request,
  onWithdrawn,
}: {
  request: StudentEnrollmentRequest;
  onWithdrawn: (updated: StudentEnrollmentRequest) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      onWithdrawn(await postJson<StudentEnrollmentRequest>(`/student/enrollment-requests/${request.id}/withdraw`));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div className="border-t border-base-300 p-3">
        <button type="button" onClick={() => setAsking(true)} className="btn btn-ghost btn-sm w-full rounded-full text-mute">
          Retirar solicitud
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-base-300 p-3">
      <p className="text-sm">¿Retirar esta solicitud? El director ya no la verá.</p>
      <FormError message={error} />
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={withdraw} className="btn btn-error btn-sm flex-1 rounded-full">
          {busy ? <span className="loading loading-spinner loading-sm" aria-label="Un momento" /> : 'Sí, retirar'}
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className="btn btn-ghost btn-sm rounded-full">
          No
        </button>
      </div>
    </div>
  );
}
