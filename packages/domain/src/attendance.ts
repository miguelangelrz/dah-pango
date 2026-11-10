import { parseIsoDate, type IsoDate } from './dates';
import { programForGeneralMakeup, type LedgerEntry } from './makeups';
import { can, isSuperAdmin } from './roles';

export const ATTENDANCE_STATES = ['present', 'absent', 'excused', 'makeup'] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export const ATTENDANCE_ORIGINS = ['enrolled', 'makeup', 'walk_in'] as const;
export type AttendanceOrigin = (typeof ATTENDANCE_ORIGINS)[number];

/** Spanish labels shown in the app. */
export const ATTENDANCE_LABELS: Record<AttendanceState, string> = {
  present: 'Asistió',
  absent: 'Falta',
  excused: 'Falta con aviso',
  makeup: 'Reposición',
};

const HOUR_MS = 60 * 60 * 1000;
export const LOCK_AFTER_HOURS = 24;
export const NOTICE_BEFORE_HOURS = 24;

/** Attendance locks 24 hours after the session ends. */
export function locksAt(sessionEndsAt: Date): Date {
  return new Date(sessionEndsAt.getTime() + LOCK_AFTER_HOURS * HOUR_MS);
}

export function isLocked(sessionEndsAt: Date, now: Date): boolean {
  return now.getTime() >= locksAt(sessionEndsAt).getTime();
}

/** Students can notify an absence in the app until 24 hours before the session starts. */
export function studentCanNotify(sessionStartsAt: Date, now: Date): boolean {
  return now.getTime() <= sessionStartsAt.getTime() - NOTICE_BEFORE_HOURS * HOUR_MS;
}

/** Why a student can't send an absence notice for this sesión now, or null. */
export function noticeProblem(
  session: SessionTiming,
  listedAs: { origin: AttendanceOrigin; state: AttendanceState | null } | null,
  now: Date,
): string | null {
  if (session.status === 'cancelled') return 'Esta sesión fue cancelada';
  if (session.status === 'rescheduled') return 'Esta sesión se movió a otra fecha';
  if (!listedAs || listedAs.origin !== 'enrolled') return 'No estás inscrito en esta sesión';
  if (listedAs.state === 'excused') return 'Ya avisaste que no vienes';
  if (listedAs.state !== null) return 'Esta sesión ya tiene tu asistencia marcada';
  if (!studentCanNotify(session.startsAt, now)) {
    return 'El aviso se manda hasta 24 horas antes de la clase. Habla con tu profe.';
  }
  return null;
}

/** States allowed for each way a person got on the list. */
export function allowedStates(origin: AttendanceOrigin): AttendanceState[] {
  switch (origin) {
    case 'enrolled':
      return ['present', 'absent', 'excused'];
    case 'makeup':
      return ['makeup', 'absent'];
    case 'walk_in':
      return ['present'];
  }
}

/** Walk-ins are marked present on arrival; makeups start as Reposición. */
export function initialState(origin: AttendanceOrigin): AttendanceState | null {
  if (origin === 'walk_in') return 'present';
  if (origin === 'makeup') return 'makeup';
  return null;
}

/** At the lock, anyone still unmarked becomes Falta. */
export function stateAtLock(current: AttendanceState | null): AttendanceState {
  return current ?? 'absent';
}

export type LedgerReason = 'notice' | 'cancellation' | 'makeup' | 'reversal';

/** Reposition ledger rows a state change produces (credit for a notice, debit for a makeup). */
export function ledgerEffect(
  from: AttendanceState | null,
  to: AttendanceState,
): { delta: 1 | -1; reason: LedgerReason }[] {
  const effects: { delta: 1 | -1; reason: LedgerReason }[] = [];
  if (from !== 'excused' && to === 'excused') effects.push({ delta: 1, reason: 'notice' });
  if (from === 'excused' && to !== 'excused') effects.push({ delta: -1, reason: 'reversal' });
  if (from !== 'makeup' && to === 'makeup') effects.push({ delta: -1, reason: 'makeup' });
  if (from === 'makeup' && to !== 'makeup') effects.push({ delta: 1, reason: 'reversal' });
  return effects;
}

export const ORIGIN_LABELS: Record<AttendanceOrigin, string> = {
  enrolled: 'Inscrito',
  makeup: 'Reposición',
  walk_in: 'Visitante',
};

export interface SessionTiming {
  startsAt: Date;
  endsAt: Date;
  status: 'scheduled' | 'cancelled' | 'rescheduled';
}

/**
 * Why a state can't be written on a session right now, or null when it can.
 * Falta con aviso can be marked any time before the lock; the other states only once the
 * session has started, since nobody has attended or missed it before then.
 */
export function markProblem(
  session: SessionTiming,
  origin: AttendanceOrigin,
  state: AttendanceState,
  now: Date,
): string | null {
  if (session.status === 'cancelled') return 'Esta sesión fue cancelada';
  if (session.status === 'rescheduled') return 'Esta sesión se movió a otra fecha';
  if (isLocked(session.endsAt, now)) return 'La asistencia de esta sesión ya se cerró';
  if (!allowedStates(origin).includes(state)) {
    const who = { enrolled: 'alguien inscrito', makeup: 'una reposición', walk_in: 'un visitante' }[origin];
    return `«${ATTENDANCE_LABELS[state]}» no aplica para ${who}`;
  }
  if (state !== 'excused' && now.getTime() < session.startsAt.getTime()) {
    return 'La clase todavía no empieza: por ahora solo se puede marcar Falta con aviso';
  }
  return null;
}

/**
 * Makeups and walk-ins join once the session has started, and can be taken off the list
 * (if added by mistake) until the lock.
 */
export function addPersonProblem(session: SessionTiming, now: Date): string | null {
  if (session.status !== 'scheduled') return markProblem(session, 'makeup', 'makeup', now);
  if (isLocked(session.endsAt, now)) return 'La asistencia de esta sesión ya se cerró';
  if (now.getTime() < session.startsAt.getTime()) {
    return 'Las reposiciones y los visitantes se agregan cuando empieza la clase';
  }
  return null;
}

/**
 * Who takes attendance: the session's teacher (the default one or a substitute), or any
 * director or super admin, who also cover guest teachers without an account.
 */
export function canTakeAttendanceFor(
  roles: Parameters<typeof can>[0],
  personId: string,
  sessionTeacherId: string,
): boolean {
  if (!can(roles, 'take_attendance')) return false;
  return isSuperAdmin(roles) || personId === sessionTeacherId;
}

/** The source logged in attendance_event for a write by this person. */
export function writeSource(
  roles: Parameters<typeof can>[0],
  personId: string,
  sessionTeacherId: string,
): 'teacher' | 'director' {
  return personId !== sessionTeacherId && isSuperAdmin(roles) ? 'director' : 'teacher';
}

export interface DatedEnrollment {
  studentId: string;
  trackId: string | null;
  courseId: string | null;
  validFrom: IsoDate;
  validTo: IsoDate;
}

/**
 * Students enrolled in a clase on a date: directly, or through one of the líneas that
 * hold it. Someone in two of those líneas appears once.
 */
export function enrolledOn(
  enrollments: DatedEnrollment[],
  course: { id: string; trackIds: string[] },
  date: IsoDate,
): string[] {
  const tracks = new Set(course.trackIds);
  const day = parseIsoDate(date);
  const ids = new Set<string>();
  for (const e of enrollments) {
    const covers = e.courseId === course.id || (e.trackId !== null && tracks.has(e.trackId));
    if (covers && parseIsoDate(e.validFrom) <= day && day <= parseIsoDate(e.validTo)) ids.add(e.studentId);
  }
  return [...ids];
}

/**
 * The programa a ledger row counts against. A clase in a programa uses it. A general clase
 * uses the student's most recent Falta con aviso (`programForGeneralMakeup`), and when they
 * never had one, the first programa they are enrolled in. Null: nobody can tell, so a
 * director has to decide.
 */
export function ledgerProgram(
  courseProgramId: string | null,
  history: LedgerEntry[],
  enrolledProgramIds: string[],
): string | null {
  if (courseProgramId) return courseProgramId;
  return programForGeneralMakeup(history) ?? enrolledProgramIds[0] ?? null;
}
