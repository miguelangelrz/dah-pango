'use client';

import type { AttendanceSessionDetail, PersonMatch, RosterRow, TeacherOption } from '@dah-pango/contracts';
import { ATTENDANCE_LABELS, DOCUMENT_TYPES, allowedStates, type AttendanceState, type DocumentType } from '@dah-pango/domain';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/form';
import { deleteJson, getJson, postJson, putJson } from '@/lib/api';
import { formatDayLong, formatMoment, formatTime } from '@/lib/format';

const SHORT_LABELS: Record<AttendanceState, string> = {
  present: 'Asistió',
  absent: 'Falta',
  excused: 'Con aviso',
  makeup: 'Reposición',
};

const STATE_CLASSES: Record<AttendanceState, string> = {
  present: 'btn-success',
  absent: 'btn-error',
  excused: 'btn-warning',
  makeup: 'btn-info',
};

function bogotaDay(instant: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(instant));
}

export function SessionAttendance({ initial, teachers }: { initial: AttendanceSessionDetail; teachers: TeacherOption[] }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/attendance/sessions/${s.id}`;

  async function run(key: string, work: () => Promise<AttendanceSessionDetail>) {
    setBusy(key);
    setError(null);
    try {
      setS(await work());
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  const mark = (personId: string, state: AttendanceState) =>
    run(personId, () => putJson(`${path}/marks`, { marks: [{ personId, state }] }));

  const unmarked = s.roster.filter((r) => r.state === null && r.origin === 'enrolled');
  const counts = (Object.keys(ATTENDANCE_LABELS) as AttendanceState[])
    .map((state) => [state, s.roster.filter((r) => r.state === state).length] as const)
    .filter(([, n]) => n > 0);

  return (
    <div className="mt-8 flex-1 space-y-6">
      <div>
        <p className="text-sm text-mute first-letter:uppercase">
          {formatDayLong(bogotaDay(s.startsAt))} · {formatTime(s.startsAt)} – {formatTime(s.endsAt)}
        </p>
        <h1 className="mt-1 font-display text-4xl leading-none uppercase sm:text-5xl" style={s.program?.accentColor ? { color: s.program.accentColor } : undefined}>
          {s.course.title}
        </h1>
        <p className="mt-2 text-sm text-mute">
          {s.program?.name ?? 'Clase general'}
          {s.topic ? ` · ${s.topic}` : ''}
          {s.modality === 'online' ? ' · En línea' : s.room ? ` · ${s.room}` : ''}
          {' · '}Profe: {s.mine ? 'tú' : s.teacher.fullName}
          {!s.teacher.hasAccount && ' (invitado)'}
        </p>
        {s.handoffs.length > 0 && (
          <p className="mt-1 text-xs text-mute">
            {s.handoffs.map((h) => `Pasó de ${h.from} a ${h.to} (${formatMoment(h.madeAt)})`).join(' · ')}
          </p>
        )}
      </div>

      {s.notice ? (
        <p role="status" className={`alert alert-soft text-sm ${s.canEdit ? 'alert-info' : ''}`}>
          {s.notice}
        </p>
      ) : (
        <p className="text-sm text-mute">Quien no tenga marca el {formatMoment(s.locksAt)} queda con Falta.</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {s.counts.marked} de {s.counts.listed} marcados
        </span>
        {counts.map(([state, n]) => (
          <span key={state} className="badge badge-ghost">
            {ATTENDANCE_LABELS[state]}: {n}
          </span>
        ))}
      </div>

      <FormError message={error} />

      <ul className="space-y-2">
        {s.roster.map((r) => (
          <Row key={r.personId} r={r} s={s} busy={busy === r.personId} onMark={mark} onRemove={() => run(r.personId, () => deleteJson(`${path}/people/${r.personId}`))} />
        ))}
        {s.roster.length === 0 && <li className="text-mute">Nadie inscrito en esta sesión todavía.</li>}
      </ul>

      {s.canEdit && s.canMarkToday && unmarked.length > 0 && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('all', () => putJson(`${path}/marks`, { marks: unmarked.map((r) => ({ personId: r.personId, state: 'present' })) }))}
          className="btn btn-primary btn-lg btn-block rounded-full font-display text-xl tracking-wide uppercase"
        >
          {busy === 'all' ? <span className="loading loading-spinner" aria-label="Un momento" /> : `Los ${unmarked.length} sin marca: Asistió`}
        </button>
      )}

      {s.canEdit && s.canMarkToday && s.status === 'scheduled' && (
        <div className="space-y-2">
          <AddMakeup sessionId={s.id} onAdded={setS} />
          <AddWalkIn sessionId={s.id} onAdded={setS} />
        </div>
      )}
      {s.canEdit && (
        <HandOff
          sessionId={s.id}
          currentTeacherId={s.teacher.id}
          teachers={teachers}
          onDone={(result) => {
            if ('handedOff' in result) router.push(`/app/asistencia?fecha=${bogotaDay(s.startsAt)}`);
            else setS(result);
          }}
        />
      )}
    </div>
  );
}

function Row({
  r,
  s,
  busy,
  onMark,
  onRemove,
}: {
  r: RosterRow;
  s: AttendanceSessionDetail;
  busy: boolean;
  onMark: (personId: string, state: AttendanceState) => void;
  onRemove: () => void;
}) {
  const states = allowedStates(r.origin);
  const canRemove = s.canEdit && s.canMarkToday && r.origin !== 'enrolled';
  return (
    <li className="rounded-box border border-base-300 bg-base-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{r.fullName}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mute">
            {r.document && <span>{r.document}</span>}
            {r.origin === 'makeup' && <span className="badge badge-info badge-soft badge-sm">Reposición</span>}
            {r.origin === 'walk_in' && (
              <span className="badge badge-soft badge-sm">{r.hasAccount ? 'Visitante' : 'Visitante sin cuenta'}</span>
            )}
            {r.noticeSent && <span className="badge badge-warning badge-soft badge-sm">Avisó que no viene</span>}
            {r.balance !== null && r.origin !== 'walk_in' && (
              <span>
                Reposiciones: <span className={r.balance < 0 ? 'text-error' : ''}>{r.balance}</span>
              </span>
            )}
          </p>
        </div>
        {busy && <span className="loading loading-spinner loading-sm" aria-label="Guardando" />}
      </div>
      {r.origin === 'walk_in' ? (
        <div className="mt-2 flex items-center justify-between">
          <span className="badge badge-success">Asistió</span>
          {canRemove && (
            <button type="button" disabled={busy} onClick={onRemove} className="btn btn-ghost btn-xs rounded-full">
              Quitar
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <div className="join flex w-full">
            {states.map((state) => {
              const active = r.state === state;
              const disabled = busy || !s.canEdit || (state !== 'excused' && !s.canMarkToday);
              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled && !active}
                  onClick={() => !active && !disabled && onMark(r.personId, state)}
                  className={`btn join-item flex-1 ${active ? STATE_CLASSES[state] : 'btn-outline border-base-300'}`}
                >
                  {SHORT_LABELS[state]}
                </button>
              );
            })}
          </div>
          {canRemove && (
            <button type="button" disabled={busy} onClick={onRemove} className="btn btn-ghost btn-sm rounded-full">
              Quitar
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="collapse-arrow collapse border border-base-300 bg-base-200">
      <summary className="collapse-title font-semibold">{title}</summary>
      <div className="collapse-content space-y-3">{children}</div>
    </details>
  );
}

function AddMakeup({ sessionId, onAdded }: { sessionId: string; onAdded: (s: AttendanceSessionDetail) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PersonMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      getJson<PersonMatch[]>(`/attendance/sessions/${sessionId}/people?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch((err: Error) => setError(err.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, sessionId]);

  async function add(personId: string) {
    setBusy(true);
    setError(null);
    try {
      onAdded(await postJson(`/attendance/sessions/${sessionId}/makeups`, { personId }));
      setQ('');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Section title="Agregar reposición">
      <p className="text-sm text-mute">
        Alguien de otra clase del mismo programa (o de cualquiera, si esta es general) que viene a reponer. Usa una
        reposición de su saldo; el saldo puede quedar negativo.
      </p>
      <input
        type="search"
        className="input w-full bg-base-100"
        placeholder="Nombre o documento"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="space-y-1">
        {results.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-field bg-base-100 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.fullName}</p>
              {p.document && <p className="text-xs text-mute">{p.document}</p>}
            </div>
            {p.listed ? (
              <span className="text-xs text-mute">Ya está en la lista</span>
            ) : (
              <button type="button" disabled={busy} onClick={() => add(p.id)} className="btn btn-primary btn-sm rounded-full">
                Agregar
              </button>
            )}
          </li>
        ))}
        {q.trim().length >= 2 && results.length === 0 && <li className="text-sm text-mute">Nadie con ese nombre o documento.</li>}
      </ul>
      <FormError message={error} />
    </Section>
  );
}

function AddWalkIn({ sessionId, onAdded }: { sessionId: string; onAdded: (s: AttendanceSessionDetail) => void }) {
  const [form, setForm] = useState({ fullName: '', phone: '', documentType: '' as DocumentType | '', documentNumber: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(
        await postJson(`/attendance/sessions/${sessionId}/walk-ins`, {
          fullName: form.fullName,
          phone: form.phone,
          ...(form.documentType && form.documentNumber ? { documentType: form.documentType, documentNumber: form.documentNumber } : {}),
        }),
      );
      setForm({ fullName: '', phone: '', documentType: '', documentNumber: '' });
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Section title="Agregar visitante">
      <p className="text-sm text-mute">
        Alguien sin cuenta que vino hoy. Queda con Asistió. Con su documento, este historial se une a su cuenta cuando
        se registre.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input className="input w-full bg-base-100" placeholder="Nombre completo" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <input className="input w-full bg-base-100" placeholder="Celular" type="tel" inputMode="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <select className="select bg-base-100" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as DocumentType | '' })} aria-label="Tipo de documento">
            <option value="">Sin doc.</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input className="input w-full bg-base-100" placeholder="Número de documento" inputMode="numeric" disabled={!form.documentType} value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} />
        </div>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="btn btn-primary btn-block rounded-full">
          {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Agregar como Asistió'}
        </button>
      </form>
    </Section>
  );
}

function HandOff({
  sessionId,
  currentTeacherId,
  teachers,
  onDone,
}: {
  sessionId: string;
  currentTeacherId: string;
  teachers: TeacherOption[];
  onDone: (r: AttendanceSessionDetail | { handedOff: true }) => void;
}) {
  const options = teachers.filter((t) => t.id !== currentTeacherId);
  const [choice, setChoice] = useState<string>('');
  const [guest, setGuest] = useState({ fullName: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('¿Pasar esta sesión? Quien la recibe toma la asistencia.')) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        choice === 'guest'
          ? { guest: { fullName: guest.fullName, ...(guest.phone ? { phone: guest.phone } : {}) } }
          : { teacherId: choice };
      onDone(await putJson(`/attendance/sessions/${sessionId}/teacher`, body));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Section title="Pasar la sesión a otro profe">
      <p className="text-sm text-mute">
        Para un reemplazo. Si es un profe invitado sin cuenta, la dirección toma la asistencia.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <select className="select w-full bg-base-100" required value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Profe">
          <option value="" disabled>
            Elige quién la toma
          </option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName}
              {t.hasAccount ? '' : ' (sin cuenta)'}
            </option>
          ))}
          <option value="guest">Profe invitado nuevo…</option>
        </select>
        {choice === 'guest' && (
          <>
            <input className="input w-full bg-base-100" placeholder="Nombre del profe invitado" required value={guest.fullName} onChange={(e) => setGuest({ ...guest, fullName: e.target.value })} />
            <input className="input w-full bg-base-100" placeholder="Celular (opcional)" type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
          </>
        )}
        <FormError message={error} />
        <button type="submit" disabled={busy || !choice} className="btn btn-outline btn-block rounded-full">
          {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Pasar la sesión'}
        </button>
      </form>
    </Section>
  );
}
