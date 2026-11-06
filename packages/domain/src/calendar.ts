import type { BlockRange } from './blocks';
import { bogotaInstant, parseIsoDate, type IsoDate } from './dates';
import { occurrences, type WeeklySlot } from './schedule';

// Rules for what a director configures: semestres, their bloques, and the weekly
// slots of each clase, plus how the generated sesiones follow those changes.

export const WEEKDAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - 1] ?? `Día ${weekday}`;
}

export interface DateRange {
  startsOn: IsoDate;
  endsOn: IsoDate;
}

function overlaps(a: DateRange, b: DateRange): boolean {
  return parseIsoDate(a.startsOn) <= parseIsoDate(b.endsOn) && parseIsoDate(b.startsOn) <= parseIsoDate(a.endsOn);
}

/** Why a semestre's dates can't be saved, or null when they can. */
export function termProblem(term: DateRange, otherTerms: DateRange[]): string | null {
  if (parseIsoDate(term.endsOn) < parseIsoDate(term.startsOn)) {
    return 'El semestre termina antes de empezar';
  }
  if (otherTerms.some((o) => overlaps(term, o))) return 'Las fechas se cruzan con otro semestre';
  return null;
}

/**
 * Why a semestre's bloques can't be saved, or null when they can. Bloques go in order,
 * don't overlap and stay inside the semestre. Gaps are allowed (for example a holiday week).
 */
export function blocksProblem(term: DateRange, blocks: BlockRange[]): string | null {
  if (blocks.length === 0) return 'El semestre necesita al menos un bloque';
  for (const [i, b] of blocks.entries()) {
    if (b.number !== i + 1) return 'Los bloques deben ir numerados en orden desde 1';
    if (parseIsoDate(b.endsOn) < parseIsoDate(b.startsOn)) {
      return `El bloque ${b.number} termina antes de empezar`;
    }
    if (parseIsoDate(b.startsOn) < parseIsoDate(term.startsOn) || parseIsoDate(b.endsOn) > parseIsoDate(term.endsOn)) {
      return `El bloque ${b.number} se sale de las fechas del semestre`;
    }
    const prev = blocks[i - 1];
    if (prev && parseIsoDate(b.startsOn) <= parseIsoDate(prev.endsOn)) {
      return `El bloque ${b.number} empieza antes de que termine el ${prev.number}`;
    }
  }
  return null;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'HH:MM' (or 'HH:MM:SS' from Postgres) without seconds. */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

export function slotDurationMinutes(slot: Pick<WeeklySlot, 'startsAt' | 'endsAt'>): number {
  return timeToMinutes(slot.endsAt) - timeToMinutes(slot.startsAt);
}

/** A slot from its start and duration; null when it would run past midnight. */
export function slotFromDuration(weekday: number, startsAt: string, durationMinutes: number): WeeklySlot | null {
  const end = timeToMinutes(startsAt) + durationMinutes;
  if (durationMinutes <= 0 || end > 24 * 60 - 1) return null;
  return { weekday, startsAt: shortTime(startsAt), endsAt: minutesToTime(end) };
}

/** Why a clase's weekly slots can't be saved, or null. A clase can't be in two places at once. */
export function slotsProblem(slots: WeeklySlot[]): string | null {
  for (const [i, a] of slots.entries()) {
    if (timeToMinutes(a.endsAt) <= timeToMinutes(a.startsAt)) {
      return `El horario del ${weekdayLabel(a.weekday).toLowerCase()} termina antes de empezar`;
    }
    for (const b of slots.slice(i + 1)) {
      if (
        a.weekday === b.weekday &&
        timeToMinutes(a.startsAt) < timeToMinutes(b.endsAt) &&
        timeToMinutes(b.startsAt) < timeToMinutes(a.endsAt)
      ) {
        return `Hay dos horarios que se cruzan el ${weekdayLabel(a.weekday).toLowerCase()}`;
      }
    }
  }
  return null;
}

export interface PlannedSession {
  date: IsoDate;
  startsAt: Date;
  endsAt: Date;
}

/** Every sesión a weekly clase should have between two dates (inclusive), in order. */
export function planSessions(slots: WeeklySlot[], range: DateRange): PlannedSession[] {
  if (parseIsoDate(range.endsOn) < parseIsoDate(range.startsOn)) return [];
  return slots
    .flatMap((s) =>
      occurrences(s.weekday, range.startsOn, range.endsOn).map((date) => ({
        date,
        startsAt: bogotaInstant(date, shortTime(s.startsAt)),
        endsAt: bogotaInstant(date, shortTime(s.endsAt)),
      })),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The days a clase runs within a semestre: the semestre, cut to the clase's own dates if it has them. */
export function courseRangeInTerm(
  term: DateRange,
  course: { startsOn: IsoDate | null; endsOn: IsoDate | null },
): DateRange {
  const startsOn =
    course.startsOn && parseIsoDate(course.startsOn) > parseIsoDate(term.startsOn) ? course.startsOn : term.startsOn;
  const endsOn = course.endsOn && parseIsoDate(course.endsOn) < parseIsoDate(term.endsOn) ? course.endsOn : term.endsOn;
  return { startsOn, endsOn };
}

export interface ExistingSession {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: 'scheduled' | 'cancelled' | 'rescheduled';
  /** Attendance, absence notices, makeup requests or ledger rows point at it. */
  hasRecords: boolean;
  /** Created by a reschedule, so it follows no weekly slot. */
  isRescheduleTarget: boolean;
}

export interface SessionSync {
  create: PlannedSession[];
  update: { id: string; endsAt: Date }[];
  remove: string[];
  /** Sesiones the new schedule drops but that already have records: a director must cancel them. */
  keep: string[];
}

/**
 * How a clase's sesiones follow a new schedule. Only sesiones that haven't started are
 * touched, so what already happened stays as it was. A sesión at the same start time is
 * kept (its end follows the new duration); one the schedule no longer has is removed,
 * unless something already points at it.
 */
export function syncSessions(existing: ExistingSession[], planned: PlannedSession[], now: Date): SessionSync {
  const result: SessionSync = { create: [], update: [], remove: [], keep: [] };
  const byStart = new Map(existing.map((s) => [s.startsAt.getTime(), s]));
  const plannedStarts = new Set<number>();

  for (const p of planned) {
    if (p.startsAt <= now) continue;
    plannedStarts.add(p.startsAt.getTime());
    const match = byStart.get(p.startsAt.getTime());
    if (!match) result.create.push(p);
    else if (match.status === 'scheduled' && match.endsAt.getTime() !== p.endsAt.getTime()) {
      result.update.push({ id: match.id, endsAt: p.endsAt });
    }
  }

  for (const s of existing) {
    if (s.startsAt <= now || s.status !== 'scheduled' || s.isRescheduleTarget) continue;
    if (plannedStarts.has(s.startsAt.getTime())) continue;
    (s.hasRecords ? result.keep : result.remove).push(s.id);
  }
  return result;
}
