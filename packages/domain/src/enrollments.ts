import { addDays, parseIsoDate, type IsoDate } from './dates';
import { findOverlaps, type ScheduledCourse } from './schedule';

// A student's own changes to their clases (Mis programas): requests to add or change a
// clase, which a director approves, and cancelling a clase, which applies right away from
// the date the student picks.

export const ENROLLMENT_ACTIONS = ['join', 'swap', 'leave'] as const;
export type EnrollmentAction = (typeof ENROLLMENT_ACTIONS)[number];

/** What each request asks for, as the student reads it. */
export const ENROLLMENT_ACTION_LABELS: Record<EnrollmentAction, string> = {
  join: 'Agregar clase',
  swap: 'Cambiar clase',
  leave: 'Cancelar clase',
};

export const REQUEST_STATUSES = ['pending', 'approved', 'denied', 'withdrawn'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Clases the student already has that `candidate` would overlap in time. */
export function clashesWith(existing: ScheduledCourse[], candidate: ScheduledCourse): string[] {
  const clashes: string[] = [];
  for (const [a, b] of findOverlaps([...existing, candidate])) {
    if (b === candidate.courseId && a !== candidate.courseId) clashes.push(a);
  }
  return clashes;
}

export interface OpenEnrollment {
  validFrom: IsoDate;
  validTo: IsoDate;
}

/**
 * The new last day of an inscripción when the student leaves after `lastDay`, or null when
 * it already ends by then. One that hasn't started yet ends the day before it starts, so it
 * covers no day at all.
 */
export function closingValidTo(enrollment: OpenEnrollment, lastDay: IsoDate): IsoDate | null {
  if (parseIsoDate(enrollment.validTo) <= parseIsoDate(lastDay)) return null;
  const beforeStart = addDays(enrollment.validFrom, -1);
  return parseIsoDate(lastDay) < parseIsoDate(beforeStart) ? beforeStart : lastDay;
}

/**
 * The first day a student can drop off a clase's list: today, or tomorrow when today's
 * sesión already started (that one keeps them).
 */
export function earliestLeaveOn(today: IsoDate, startedToday: boolean): IsoDate {
  return startedToday ? addDays(today, 1) : today;
}

/** Why a student can't drop off a clase's list from `leaveOn`, or null. */
export function leaveOnProblem(
  leaveOn: IsoDate,
  input: { today: IsoDate; startedToday: boolean; enrolledUntil: IsoDate },
): string | null {
  const day = parseIsoDate(leaveOn);
  if (day < parseIsoDate(input.today)) return 'La fecha no puede ser antes de hoy';
  if (day < parseIsoDate(earliestLeaveOn(input.today, input.startedToday))) {
    return 'La clase de hoy ya empezó. Elige una fecha desde mañana.';
  }
  if (day > parseIsoDate(input.enrolledUntil)) return 'Esa fecha es después del final de tu inscripción';
  return null;
}

export interface LeavePlan {
  /** The inscripción's new last day; null when it already ends by then. */
  closeValidTo: IsoDate | null;
  /** When it was a whole línea: the other clases of it, kept from `leaveOn` as single clases. */
  keep: { courseId: string; validFrom: IsoDate; validTo: IsoDate }[];
}

/**
 * Leaving one clase from `leaveOn`. A single-clase inscripción just closes. A línea closes
 * too, and the student stays in its other clases through new single-clase inscripciones
 * that run until the línea would have ended.
 */
export function planLeave(
  enrollment: OpenEnrollment,
  leaveOn: IsoDate,
  otherCourseIds: string[],
): LeavePlan {
  const closeValidTo = closingValidTo(enrollment, addDays(leaveOn, -1));
  const validFrom = parseIsoDate(leaveOn) > parseIsoDate(enrollment.validFrom) ? leaveOn : enrollment.validFrom;
  const keep =
    closeValidTo === null || parseIsoDate(validFrom) > parseIsoDate(enrollment.validTo)
      ? []
      : otherCourseIds.map((courseId) => ({ courseId, validFrom, validTo: enrollment.validTo }));
  return { closeValidTo, keep };
}
