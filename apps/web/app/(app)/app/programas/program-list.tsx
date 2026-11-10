'use client';

import type {
  CourseLeaveResult,
  CourseOption,
  EnrolledCourse,
  StudentCourse,
  StudentEnrollmentRequest,
  StudentProgram,
} from '@dah-pango/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/form';
import { ProgramStripe } from '@/components/page-shell';
import { getJson, postJson } from '@/lib/api';
import { formatDayLong, formatSlots } from '@/lib/format';

/** What the student is doing right now; one at a time on the whole screen. */
type Panel =
  | { kind: 'join'; group: string }
  | { kind: 'swap'; group: string; course: StudentCourse }
  | { kind: 'leave'; group: string; course: StudentCourse };

/** A programa's key on this screen; general clases have no programa. */
const groupKey = (p: StudentProgram) => p.program?.id ?? 'general';
const groupName = (p: StudentProgram) => p.program?.name ?? 'Clases generales';

export function ProgramList({ programs, pending: initial }: { programs: StudentProgram[]; pending: StudentEnrollmentRequest[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(initial);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [flash, setFlash] = useState<{ group: string; text: string } | null>(null);
  // After cancelling a clase the page reloads its data from the server.
  useEffect(() => setPending(initial), [initial]);


  function open(next: Panel | null) {
    setPanel(next);
    setFlash(null);
  }

  function sent(group: string, request: StudentEnrollmentRequest) {
    setPending((list) => [request, ...list]);
    setPanel(null);
    setOpenCourse(null);
    setFlash({ group, text: 'Listo. Tu solicitud quedó pendiente de aprobación del director.' });
  }

  function left(group: string, course: StudentCourse, result: CourseLeaveResult) {
    setPanel(null);
    setOpenCourse(null);
    const withdrawn = result.withdrawnRequests ? ' También retiramos tu solicitud de cambio pendiente.' : '';
    setFlash({
      group,
      text: `Listo. Desde el ${formatDayLong(result.leaveOn)} ya no apareces en la lista de ${course.title}.${withdrawn}`,
    });
    router.refresh();
  }

  const shared = { pending, panel, open, sent, left };

  return (
    <div className="space-y-8">
      {flash?.group === 'page' && <Flash text={flash.text} />}
      {programs.length === 0 && (
        <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-mute">
          No estás inscrito en ninguna clase este semestre.
        </p>
      )}

      {programs.map((p) => (
        <ProgramSection
          key={groupKey(p)}
          program={p}
          openCourse={openCourse}
          setOpenCourse={(id) => {
            setOpenCourse(id);
            open(null);
          }}
          flash={flash?.group === groupKey(p) ? flash.text : null}
          {...shared}
        />
      ))}

      <div role="note" className="alert alert-soft alert-info items-start text-sm">
        <span aria-hidden className="text-lg leading-none">
          ⓘ
        </span>
        <span>
          Agregar o cambiar una clase necesita la validación del director; mientras lo revisa, sigues en tus clases como
          están. Cancelar una clase no la necesita: se aplica desde la fecha que elijas.
        </span>
      </div>
    </div>
  );
}

function Flash({ text }: { text: string }) {
  return (
    <p role="status" className="mt-3 rounded-field bg-success/10 px-3 py-2 text-sm text-success">
      {text}
    </p>
  );
}

interface SharedProps {
  pending: StudentEnrollmentRequest[];
  panel: Panel | null;
  open: (next: Panel | null) => void;
  sent: (group: string, request: StudentEnrollmentRequest) => void;
  left: (group: string, course: StudentCourse, result: CourseLeaveResult) => void;
}

function ProgramSection({
  program: p,
  openCourse,
  setOpenCourse,
  flash,
  pending,
  panel,
  open,
  sent,
  left,
}: SharedProps & {
  program: StudentProgram;
  openCourse: string | null;
  setOpenCourse: (id: string | null) => void;
  flash: string | null;
}) {
  const group = groupKey(p);
  const asked = pending.filter((r) => (r.programId ?? 'general') === group);
  const here = panel?.group === group ? panel : null;

  return (
    <section aria-labelledby={`program-${group}`} className="space-y-3">
      <h2 id={`program-${group}`} className="flex items-center gap-2 border-b border-base-300 pb-1">
        <span aria-hidden className="size-3 rounded-full" style={{ background: p.program?.accentColor ?? 'var(--color-chalk)' }} />
        <span className="font-display text-3xl uppercase">{groupName(p)}</span>
        <span className="ml-auto text-sm text-mute">
          {p.courses.length} {p.courses.length === 1 ? 'clase' : 'clases'}
        </span>
      </h2>
      {flash && <Flash text={flash} />}

      <ul className="space-y-2">
        {p.courses.map((c) => {
          const request = asked.find((r) => r.replacesCourse?.id === c.id);
          const expanded = openCourse === c.id && !request;
          const acting = here && (here.kind === 'swap' || here.kind === 'leave') && here.course.id === c.id ? here : null;
          return (
            <li key={c.id} className={`rounded-box border bg-base-200 ${expanded ? 'border-primary' : 'border-base-300'}`}>
              <button
                type="button"
                disabled={Boolean(request)}
                aria-expanded={expanded}
                onClick={() => setOpenCourse(expanded ? null : c.id)}
                className="flex w-full items-stretch gap-3 p-4 text-left disabled:cursor-default"
              >
                <ProgramStripe color={p.program?.accentColor} />
                <CourseSummary course={c} />
                <span className="flex shrink-0 items-center">
                  {request ? (
                    <span className="badge badge-warning badge-soft">
                      Cambio pendiente
                    </span>
                  ) : (
                    <span aria-hidden className={`text-2xl text-mute transition ${expanded ? 'rotate-90' : ''}`}>
                      ›
                    </span>
                  )}
                </span>
              </button>
              {request?.action === 'swap' && request.course && (
                <p className="-mt-2 px-4 pb-3 pl-8 text-sm text-mute">Pediste cambiarla por {request.course.title}.</p>
              )}

              {expanded && !acting && (
                <div className="flex gap-2 border-t border-base-300 p-3">
                  <button type="button" onClick={() => open({ kind: 'swap', group, course: c })} className="btn btn-outline btn-sm flex-1 rounded-full">
                    Cambiar clase
                  </button>
                  <button
                    type="button"
                    onClick={() => open({ kind: 'leave', group, course: c })}
                    className="btn btn-outline btn-error btn-sm flex-1 rounded-full"
                  >
                    Cancelar clase
                  </button>
                </div>
              )}
              {expanded && acting?.kind === 'swap' && (
                <div className="border-t border-base-300 p-3">
                  <CoursePicker
                    programId={p.program?.id ?? null}
                    group={group}
                    replaces={c}
                    onCancel={() => open(null)}
                    onSent={sent}
                  />
                </div>
              )}
              {expanded && acting?.kind === 'leave' && (
                <div className="border-t border-base-300 p-3">
                  <LeaveCourse course={c} onCancel={() => open(null)} onLeft={(result) => left(group, c, result)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <PendingJoins requests={asked} />

      {here?.kind === 'join' ? (
        <div className="rounded-box border border-primary bg-base-200 p-4">
          <CoursePicker programId={p.program?.id ?? null} group={group} onCancel={() => open(null)} onSent={sent} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpenCourse(null);
            open({ kind: 'join', group });
          }}
          className="btn btn-block rounded-box border-dashed border-base-300 bg-transparent font-normal hover:border-primary"
        >
          + Agregar clase
        </button>
      )}

    </section>
  );
}

function CourseSummary({ course: c }: { course: StudentCourse }) {
  const place = c.modality === 'online' ? 'En línea' : c.room;
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">{c.title}</span>
      {formatSlots(c.slots).map((line) => (
        <span key={line} className="block text-sm">
          {line}
        </span>
      ))}
      {(c.teacherName || place) && (
        <span className="block text-xs text-mute">{[c.teacherName, place].filter(Boolean).join(' · ')}</span>
      )}
    </span>
  );
}

/** Requests to add a clase, shown under the programa until the director answers. */
function PendingJoins({ requests }: { requests: StudentEnrollmentRequest[] }) {
  const joins = requests.filter((r) => r.action === 'join' && r.course);
  if (joins.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {joins.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 rounded-box border border-dashed border-base-300 px-4 py-3">
          <span className="min-w-0 text-sm">
            <span className="text-mute">Pediste agregar </span>
            <span className="font-semibold">{r.course!.title}</span>
          </span>
          <span className="badge badge-warning badge-soft shrink-0">Pendiente</span>
        </li>
      ))}
    </ul>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-mute">Mensaje para el director (opcional)</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} rows={2} className="textarea mt-1 w-full bg-base-100" />
    </label>
  );
}

function Actions({ busy, label, onCancel, danger }: { busy: boolean; label: string; onCancel: () => void; danger?: boolean }) {
  return (
    <div className="flex gap-2">
      <button type="submit" disabled={busy} className={`btn flex-1 rounded-full ${danger ? 'btn-error' : 'btn-primary'}`}>
        {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : label}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className="btn btn-ghost rounded-full">
        Volver
      </button>
    </div>
  );
}

/** Picks a clase to add, or to change `replaces` for, from a list of cards (not a select). */
function CoursePicker({
  programId,
  group,
  replaces,
  onCancel,
  onSent,
}: {
  programId: string | null;
  group: string;
  replaces?: StudentCourse;
  onCancel: () => void;
  onSent: (group: string, request: StudentEnrollmentRequest) => void;
}) {
  const [options, setOptions] = useState<CourseOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (programId) query.set('programId', programId);
    if (replaces) query.set('replacesCourseId', replaces.id);
    getJson<CourseOption[]>(`/student/course-options?${query}`)
      .then(setOptions)
      .catch((err: Error) => setError(err.message));
  }, [programId, replaces]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return setError('Elige una clase');
    setBusy(true);
    setError(null);
    try {
      const body = { courseId: selected, note: note.trim() || undefined };
      const request = replaces
        ? await postJson<StudentEnrollmentRequest>('/student/enrollment-requests/swap', { ...body, replacesCourseId: replaces.id })
        : await postJson<StudentEnrollmentRequest>('/student/enrollment-requests/join', body);
      onSent(group, request);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const free = options?.filter((o) => o.clashesWith.length === 0 && !o.requested) ?? [];

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="font-semibold">{replaces ? `Cambiar ${replaces.title} por:` : 'Elige la clase que quieres agregar'}</p>
      {options === null && !error && <span className="loading loading-dots" aria-label="Cargando clases" />}
      {options?.length === 0 && <p className="text-sm text-mute">No hay más clases en este programa por ahora.</p>}
      {options && options.length > 0 && (
        <ul className="space-y-2" role="radiogroup" aria-label="Clases disponibles">
          {options.map((o) => {
            const blocked = o.clashesWith.length > 0 || o.requested;
            const checked = selected === o.id;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={blocked}
                  onClick={() => setSelected(o.id)}
                  className={`flex w-full items-start gap-3 rounded-box border p-3 text-left transition ${
                    checked ? 'border-primary bg-primary/10' : 'border-base-300 bg-base-100'
                  } ${blocked ? 'cursor-not-allowed opacity-50' : 'hover:border-primary'}`}
                >
                  <span
                    aria-hidden
                    className={`mt-1 size-4 shrink-0 rounded-full border-2 ${checked ? 'border-primary bg-primary' : 'border-base-content/40'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <CourseSummary course={o} />
                    {blocked && (
                      <span className="mt-1 block text-xs font-semibold text-warning">
                        {o.requested ? 'Ya la pediste' : `Presenta cruce con ${o.clashesWith.join(', ')}`}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {options && options.length > 0 && free.length === 0 && (
        <p className="text-sm text-mute">Por ahora ninguna clase te sirve sin cruzarse con las tuyas.</p>
      )}
      {free.length > 0 && <NoteField value={note} onChange={setNote} />}
      <FormError message={error} />
      {free.length > 0 ? (
        <Actions busy={busy} label="Enviar solicitud" onCancel={onCancel} />
      ) : (
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm rounded-full">
          Volver
        </button>
      )}
    </form>
  );
}

/** Cancelling a clase applies right away, from the date the student picks. */
function LeaveCourse({
  course,
  onCancel,
  onLeft,
}: {
  course: EnrolledCourse;
  onCancel: () => void;
  onLeft: (result: CourseLeaveResult) => void;
}) {
  const [leaveOn, setLeaveOn] = useState(course.leaveFrom ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLeft(await postJson<CourseLeaveResult>(`/student/courses/${course.id}/leave`, { leaveOn }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">
        Elige desde qué día ya no quieres aparecer en la lista de <span className="font-semibold">{course.title}</span>. Se aplica de
        una vez, sin esperar al director.
      </p>
      <label className="block">
        <span className="text-sm text-mute">Desde el</span>
        <input
          type="date"
          required
          value={leaveOn}
          min={course.leaveFrom}
          max={course.enrolledUntil}
          onChange={(e) => setLeaveOn(e.target.value)}
          className="input mt-1 w-full bg-base-100"
        />
        {leaveOn && <span className="mt-1 block text-xs text-mute first-letter:uppercase">{formatDayLong(leaveOn)}</span>}
      </label>
      <FormError message={error} />
      <Actions busy={busy} label="Cancelar clase" onCancel={onCancel} danger />
    </form>
  );
}
