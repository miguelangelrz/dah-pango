import { addDays, parseIsoDate, type IsoDate } from './dates';
import { findOverlaps, type ScheduledCourse } from './schedule';

// A student's own changes to their clases (Mis programas): requests to add, change or
// cancel a clase, which a director approves, and leaving a whole programa, which applies
// right away.

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
 * The last day a student stays in a programa they leave today: today when one of its
 * clases already started today (so that sesión keeps them on its list), otherwise yesterday.
 */
export function programLeaveLastDay(today: IsoDate, startedToday: boolean): IsoDate {
  return startedToday ? today : addDays(today, -1);
}
