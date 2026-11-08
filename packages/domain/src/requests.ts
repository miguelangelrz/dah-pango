import { studentCanNotify, type SessionTiming } from './attendance';
import { addDays, parseIsoDate, type IsoDate } from './dates';
import { findOverlaps, type ScheduledCourse } from './schedule';

// Student requests (inscripciones, cambios, salidas y reposiciones) and absence notices.
// Students ask; a director may edit the date, then approves or denies.

export const REQUEST_STATUSES = ['pending', 'approved', 'denied', 'withdrawn'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  denied: 'Negada',
  withdrawn: 'Retirada',
};

export const ENROLLMENT_ACTIONS = ['join', 'leave', 'swap'] as const;
export type EnrollmentAction = (typeof ENROLLMENT_ACTIONS)[number];

export const ENROLLMENT_ACTION_LABELS: Record<EnrollmentAction, string> = {
  join: 'Inscripción',
  leave: 'Salida',
  swap: 'Cambio',
};

export interface TermRange {
  startsOn: IsoDate;
  endsOn: IsoDate;
}

/** Why a start (or leave) date doesn't work for this semestre, or null. */
export function dateInTermProblem(term: TermRange, date: IsoDate): string | null {
  const d = parseIsoDate(date);
  if (d < parseIsoDate(term.startsOn) || d > parseIsoDate(term.endsOn)) {
    return 'La fecha tiene que estar dentro del semestre';
  }
  return null;
}

/**
 * Why a change can't take effect on this date: it must fall inside the semestre and not
 * before today, so sesiones already closed keep their lists.
 */
export function changeDateProblem(term: TermRange, date: IsoDate, today: IsoDate): string | null {
  if (parseIsoDate(date) < parseIsoDate(today)) return 'La fecha no puede ser antes de hoy';
  return dateInTermProblem(term, date);
}

/**
 * Leaving (or swapping) from `effectiveOn`: the old inscripción's last day is the day before.
 * Returns that day, or a problem when it would end before it started or already ended.
 */
export function lastDayBefore(
  enrollment: { validFrom: IsoDate; validTo: IsoDate },
  effectiveOn: IsoDate,
): { lastDay: IsoDate } | { problem: string } {
  const lastDay = addDays(effectiveOn, -1);
  if (parseIsoDate(lastDay) < parseIsoDate(enrollment.validFrom)) {
    return { problem: 'La fecha tiene que ser después del inicio de la inscripción' };
  }
  if (parseIsoDate(lastDay) >= parseIsoDate(enrollment.validTo)) {
    return { problem: 'Esa inscripción ya termina antes de esa fecha' };
  }
  return { lastDay };
}

/** Clases of `candidate` that clash in time with the student's other clases. */
export function clashesWith(existing: ScheduledCourse[], candidate: ScheduledCourse[]): string[] {
  const candidateIds = new Set(candidate.map((c) => c.courseId));
  const clashes = new Set<string>();
  for (const [a, b] of findOverlaps([...existing, ...candidate])) {
    const aNew = candidateIds.has(a);
    const bNew = candidateIds.has(b);
    // Only clashes between a new clase and one the student already has.
    if (aNew !== bNew) clashes.add(aNew ? b : a);
  }
  return [...clashes];
}

/** Why a student can't send an absence notice for this sesión now, or null. */
export function noticeProblem(
  session: SessionTiming,
  listedAs: { origin: 'enrolled' | 'makeup' | 'walk_in'; state: string | null } | null,
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

/**
 * Why a student can't ask for a reposición in this sesión, or null. Reposiciones stay in a
 * programa the student is in, or go to a general clase (no programa).
 */
export function makeupRequestProblem(input: {
  session: SessionTiming;
  now: Date;
  sessionProgramId: string | null;
  studentProgramIds: string[];
  alreadyListed: boolean;
}): string | null {
  const { session, now } = input;
  if (session.status !== 'scheduled') return 'Esta sesión no está programada';
  if (now.getTime() >= session.startsAt.getTime()) return 'Esa clase ya empezó';
  if (input.alreadyListed) return 'Ya estás en la lista de esa sesión';
  if (input.sessionProgramId && !input.studentProgramIds.includes(input.sessionProgramId)) {
    return 'Las reposiciones son en tu mismo programa o en una clase general';
  }
  return null;
}

/** Only pending requests can be reviewed. */
export function reviewProblem(status: RequestStatus): string | null {
  return status === 'pending' ? null : `Esta solicitud ya está ${REQUEST_STATUS_LABELS[status].toLowerCase()}`;
}

/**
 * A student may take back a pending request, or an approved reposición whose clase hasn't
 * started (and has no attendance yet).
 */
export function withdrawProblem(
  status: RequestStatus,
  makeup?: { startsAt: Date; marked: boolean; now: Date },
): string | null {
  if (status === 'pending') return null;
  if (status === 'approved' && makeup && !makeup.marked && makeup.now < makeup.startsAt) return null;
  return 'Esta solicitud ya no se puede retirar';
}
