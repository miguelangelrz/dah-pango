import { addDays, isoWeekday, parseIsoDate, type IsoDate } from './dates';

export interface WeeklySlot {
  weekday: number; // 1 = Monday ... 7 = Sunday
  startsAt: string; // 'HH:MM'
  endsAt: string;
}

export interface DatedWindow {
  validFrom: IsoDate;
  validTo: IsoDate;
}

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function slotsOverlap(a: WeeklySlot, b: WeeklySlot): boolean {
  return (
    a.weekday === b.weekday &&
    minutes(a.startsAt) < minutes(b.endsAt) &&
    minutes(b.startsAt) < minutes(a.endsAt)
  );
}

export function windowsOverlap(a: DatedWindow, b: DatedWindow): boolean {
  return (
    parseIsoDate(a.validFrom) <= parseIsoDate(b.validTo) &&
    parseIsoDate(b.validFrom) <= parseIsoDate(a.validTo)
  );
}

export interface ScheduledCourse extends DatedWindow {
  courseId: string;
  slots: WeeklySlot[];
}

/**
 * Pairs of a student's clases that overlap in time. The same clase reached through two
 * líneas counts once, so callers dedupe by courseId first; we skip equal ids here too.
 */
export function findOverlaps(courses: ScheduledCourse[]): [string, string][] {
  const clashes: [string, string][] = [];
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i]!;
      const b = courses[j]!;
      if (a.courseId === b.courseId || !windowsOverlap(a, b)) continue;
      if (a.slots.some((sa) => b.slots.some((sb) => slotsOverlap(sa, sb)))) {
        clashes.push([a.courseId, b.courseId]);
      }
    }
  }
  return clashes;
}

/** Dates on which a weekly slot happens between two dates (inclusive). */
export function occurrences(weekday: number, from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  let d = addDays(from, (weekday - isoWeekday(from) + 7) % 7);
  while (parseIsoDate(d) <= parseIsoDate(to)) {
    dates.push(d);
    d = addDays(d, 7);
  }
  return dates;
}
