'use client';

import type { RequestView } from '@dah-pango/contracts';
import { useState } from 'react';
import { FormError } from '@/components/form';
import { getJson, postJson } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { RequestDetails, requestTitle, StatusBadge } from '../solicitudes/request-card';

function bogotaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

export function ReviewList({ initial, all }: { initial: RequestView[]; all: boolean }) {
  const [requests, setRequests] = useState(initial);

  async function reviewed(pending: RequestView[]) {
    setRequests(all ? await getJson<RequestView[]>('/requests?estado=todas') : pending);
  }

  if (requests.length === 0) {
    return <p className="mt-6 text-center text-mute">{all ? 'Todavía no hay solicitudes.' : 'No hay solicitudes pendientes.'}</p>;
  }
  return (
    <ul className="mt-6 space-y-3">
      {requests.map((r) => (
        <li key={`${r.kind}-${r.id}`}>
          <ReviewCard r={r} onReviewed={reviewed} />
        </li>
      ))}
    </ul>
  );
}

function ReviewCard({ r, onReviewed }: { r: RequestView; onReviewed: (pending: RequestView[]) => Promise<void> }) {
  const today = bogotaToday();
  const wanted = r.kind === 'enrollment' ? r.wantedStart : null;
  const [start, setStart] = useState(wanted && wanted >= today ? wanted : today);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(decision: 'approve' | 'deny') {
    setBusy(decision);
    setError(null);
    try {
      const pending = await postJson<RequestView[]>(`/requests/${r.kind}/${r.id}/review`, {
        decision,
        approvedStart: r.kind === 'enrollment' && decision === 'approve' ? start : undefined,
        reply: reply.trim() || undefined,
      });
      await onReviewed(pending);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <article className="space-y-3 rounded-box border border-base-300 bg-base-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-mute">
            {r.student.fullName}
            {r.student.document && ` · ${r.student.document}`}
          </p>
          <h2 className="font-semibold">{requestTitle(r)}</h2>
          <p className="text-xs text-mute">Enviada el {formatDate(r.createdAt.slice(0, 10))}</p>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <RequestDetails r={r} />

      {r.status === 'pending' && (
        <div className="space-y-3 border-t border-base-300 pt-3">
          {r.kind === 'enrollment' && (
            <label className="block">
              <span className="text-sm font-medium">{r.action === 'leave' ? 'Deja de ir desde' : 'Desde'}</span>
              <input
                type="date"
                value={start}
                min={today}
                onChange={(e) => setStart(e.target.value)}
                className="input mt-1 w-full bg-base-100"
              />
            </label>
          )}
          <label className="block">
            <span className="text-sm font-medium">Respuesta para el estudiante (opcional)</span>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={500} rows={2} className="textarea mt-1 w-full bg-base-100" />
          </label>
          <FormError message={error} />
          <div className="flex gap-2">
            <button type="button" disabled={busy !== null} onClick={() => review('approve')} className="btn btn-primary flex-1 rounded-full">
              {busy === 'approve' ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Aprobar'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => review('deny')} className="btn btn-outline flex-1 rounded-full">
              {busy === 'deny' ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Negar'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
