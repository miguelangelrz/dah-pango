'use client';

import type { CourseOption, RequestOptions, RequestView } from '@dah-pango/contracts';
import { useMemo, useState } from 'react';
import { FormError } from '@/components/form';
import { postJson } from '@/lib/api';
import { formatDate, formatDayLong, formatSlots, formatTime } from '@/lib/format';
import { RequestDetails, requestTitle, StatusBadge } from './request-card';

export type RequestKind = 'join' | 'swap' | 'leave' | 'makeup';

const KIND_LABELS: Record<RequestKind, string> = {
  join: 'Inscribirme',
  swap: 'Cambiarme',
  leave: 'Salir',
  makeup: 'Reposición',
};

function bogotaDay(instant: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(instant));
}

export function RequestsScreen({
  initialRequests,
  options,
  initialKind,
}: {
  initialRequests: RequestView[];
  options: RequestOptions;
  initialKind?: RequestKind;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [kind, setKind] = useState<RequestKind | null>(initialKind ?? null);
  const [sent, setSent] = useState<string | null>(null);

  function added(r: RequestView) {
    setRequests((list) => [r, ...list]);
    setKind(null);
    setSent('Listo: tu solicitud quedó enviada. Dirección te responde aquí.');
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="new" className="space-y-3">
        <h2 id="new" className="font-display text-2xl uppercase">
          Nueva solicitud
        </h2>
        <div role="tablist" className="tabs tabs-box bg-base-200">
          {(Object.keys(KIND_LABELS) as RequestKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setSent(null);
              }}
              className={`tab flex-1 ${kind === k ? 'tab-active' : ''}`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        {sent && (
          <p role="status" className="alert alert-success alert-soft text-sm">
            {sent}
          </p>
        )}
        {!options.term && <p className="text-sm text-mute">Todavía no hay semestre configurado.</p>}
        {options.term && kind === 'makeup' && <MakeupForm options={options} onSent={added} />}
        {options.term && kind && kind !== 'makeup' && <EnrollmentForm key={kind} action={kind} options={options} onSent={added} />}
      </section>

      <section aria-labelledby="mine" className="space-y-3">
        <h2 id="mine" className="font-display text-2xl uppercase">
          Mis solicitudes
        </h2>
        {requests.length === 0 && <p className="text-sm text-mute">Todavía no has enviado solicitudes.</p>}
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <MyRequest r={r} onChange={setRequests} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MyRequest({ r, onChange }: { r: RequestView; onChange: (list: RequestView[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWithdraw =
    r.status === 'pending' || (r.kind === 'makeup' && r.status === 'approved' && new Date(r.session.startsAt) > new Date());

  async function withdraw() {
    if (!window.confirm('¿Retirar esta solicitud?')) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await postJson<RequestView[]>(`/student/requests/${r.kind}/${r.id}/withdraw`));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <article className="space-y-2 rounded-box border border-base-300 bg-base-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{requestTitle(r)}</h3>
          <p className="text-xs text-mute">Enviada el {formatDate(r.createdAt.slice(0, 10))}</p>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <RequestDetails r={r} />
      <FormError message={error} />
      {canWithdraw && (
        <button type="button" disabled={busy} onClick={withdraw} className="btn btn-ghost btn-sm rounded-full">
          Retirar
        </button>
      )}
    </article>
  );
}

function TargetPicker({
  options,
  value,
  onChange,
  exclude,
}: {
  options: RequestOptions;
  value: string;
  onChange: (v: string) => void;
  exclude?: string;
}) {
  // Values are 'track:<id>' or 'course:<id>'.
  const programs = [...new Map(options.tracks.map((t) => [t.program.id, t.program])).values()];
  const general = options.courses.filter((c) => !c.program);
  return (
    <label className="block">
      <span className="text-sm font-medium">Línea o clase</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select select-lg mt-1 w-full bg-base-200" required>
        <option value="">Elige…</option>
        {programs.map((p) => (
          <optgroup key={p.id} label={p.name}>
            {options.tracks
              .filter((t) => t.program.id === p.id && `track:${t.id}` !== exclude)
              .map((t) => (
                <option key={t.id} value={`track:${t.id}`}>
                  Línea {t.name}
                </option>
              ))}
            {options.courses
              .filter((c) => c.program?.id === p.id && `course:${c.id}` !== exclude)
              .map((c) => (
                <option key={c.id} value={`course:${c.id}`}>
                  Solo la clase {c.title}
                </option>
              ))}
          </optgroup>
        ))}
        {general.length > 0 && (
          <optgroup label="Clases generales">
            {general
              .filter((c) => `course:${c.id}` !== exclude)
              .map((c) => (
                <option key={c.id} value={`course:${c.id}`}>
                  {c.title}
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function coursesOf(options: RequestOptions, value: string): CourseOption[] {
  const [kind, id] = value.split(':');
  if (kind === 'track') return options.tracks.find((t) => t.id === id)?.courses ?? [];
  if (kind === 'course') return options.courses.filter((c) => c.id === id);
  return [];
}

function EnrollmentForm({
  action,
  options,
  onSent,
}: {
  action: 'join' | 'swap' | 'leave';
  options: RequestOptions;
  onSent: (r: RequestView) => void;
}) {
  const term = options.term!;
  const minDate = term.startsOn > options.today ? term.startsOn : options.today;
  const [target, setTarget] = useState('');
  const [replaces, setReplaces] = useState(options.enrollments[0]?.id ?? '');
  const [date, setDate] = useState(minDate);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const old = options.enrollments.find((e) => e.id === replaces);
  const picked = coursesOf(options, target);

  if (action !== 'join' && options.enrollments.length === 0) {
    return <p className="text-sm text-mute">No tienes inscripciones abiertas para cambiar o dejar.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const [kind, id] = target.split(':');
    try {
      onSent(
        await postJson<RequestView>('/student/requests/enrollment', {
          action,
          trackId: action !== 'leave' && kind === 'track' ? id : undefined,
          courseId: action !== 'leave' && kind === 'course' ? id : undefined,
          replacesEnrollmentId: action === 'join' ? undefined : replaces,
          wantedStart: date,
          note: note.trim() || undefined,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {action !== 'join' && (
        <label className="block">
          <span className="text-sm font-medium">{action === 'leave' ? '¿Qué quieres dejar?' : '¿Qué quieres cambiar?'}</span>
          <select value={replaces} onChange={(e) => setReplaces(e.target.value)} className="select select-lg mt-1 w-full bg-base-200">
            {options.enrollments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.target.kind === 'track' ? 'Línea' : 'Clase'} {e.target.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {action !== 'leave' && (
        <>
          <TargetPicker
            options={options}
            value={target}
            onChange={setTarget}
            exclude={old ? `${old.target.kind}:${old.target.id}` : undefined}
          />
          {picked.length > 0 && (
            <ul className="space-y-0.5 rounded-box bg-base-200 p-3 text-sm">
              {picked.map((c) => (
                <li key={c.id}>
                  <span className="font-medium">{c.title}:</span> <span className="text-mute">{formatSlots(c.slots)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <label className="block">
        <span className="text-sm font-medium">
          {action === 'leave' ? 'Desde cuándo dejas de ir' : action === 'swap' ? 'Desde cuándo haces el cambio' : 'Desde cuándo empiezas'}
        </span>
        <input
          type="date"
          value={date}
          min={minDate}
          max={term.endsOn}
          onChange={(e) => setDate(e.target.value)}
          required
          className="input input-lg mt-1 w-full bg-base-200"
        />
        <span className="mt-1 block text-xs text-mute">
          {action === 'leave'
            ? 'Tu última clase es la del día anterior.'
            : `Toda inscripción termina con el semestre (${formatDate(term.endsOn)}). Dirección puede ajustar la fecha.`}
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium">Mensaje para dirección (opcional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="textarea mt-1 w-full bg-base-200" />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={busy || (action !== 'leave' && !target)} className="btn btn-primary btn-lg btn-block rounded-full font-display text-xl tracking-wide uppercase">
        {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Enviar solicitud'}
      </button>
    </form>
  );
}

function MakeupForm({ options, onSent }: { options: RequestOptions; onSent: (r: RequestView) => void }) {
  const [sessionId, setSessionId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const days = new Map<string, RequestOptions['makeupSessions']>();
    for (const s of options.makeupSessions) {
      const day = bogotaDay(s.startsAt);
      days.set(day, [...(days.get(day) ?? []), s]);
    }
    return [...days.entries()];
  }, [options.makeupSessions]);

  if (options.makeupSessions.length === 0) {
    return (
      <p className="text-sm text-mute">
        No hay sesiones disponibles para reposición en las próximas tres semanas (en tu programa o en clases generales).
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSent(await postJson<RequestView>('/student/requests/makeup', { sessionId, note: note.trim() || undefined }));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-mute">Elige la sesión. Tu saldo puede quedar en negativo: tu próxima falta con aviso lo compensa.</p>
      <fieldset className="max-h-96 space-y-4 overflow-y-auto pr-1">
        <legend className="sr-only">Sesión</legend>
        {byDay.map(([day, sessions]) => (
          <div key={day} className="space-y-2">
            <p className="text-sm font-medium first-letter:uppercase">{formatDayLong(day)}</p>
            {sessions.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-box border p-3 ${sessionId === s.id ? 'border-primary bg-base-300' : 'border-base-300 bg-base-200'}`}
              >
                <input type="radio" name="session" value={s.id} checked={sessionId === s.id} onChange={() => setSessionId(s.id)} className="radio radio-primary radio-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.course.title}</span>
                  <span className="block text-xs text-mute">
                    {formatTime(s.startsAt)} – {formatTime(s.endsAt)} · {s.program?.name ?? 'Clase general'} · {s.teacherName}
                  </span>
                </span>
                <span className={`text-xs ${s.balance < 0 ? 'text-error' : 'text-mute'}`}>Saldo {s.balance}</span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <label className="block">
        <span className="text-sm font-medium">Mensaje para dirección (opcional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="textarea mt-1 w-full bg-base-200" />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={busy || !sessionId} className="btn btn-primary btn-lg btn-block rounded-full font-display text-xl tracking-wide uppercase">
        {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Pedir reposición'}
      </button>
    </form>
  );
}
