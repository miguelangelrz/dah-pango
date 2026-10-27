// Dates are plain 'YYYY-MM-DD' strings; instants are Date objects.
// Bogotá is UTC-5 all year (no daylight saving), so local wall time is a fixed offset.

export const ACADEMY_TIME_ZONE = 'America/Bogota';
const BOGOTA_OFFSET_HOURS = -5;
const DAY_MS = 24 * 60 * 60 * 1000;

export type IsoDate = string;

export function parseIsoDate(date: IsoDate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

export function formatIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return formatIsoDate(parseIsoDate(date) + days * DAY_MS);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to) - parseIsoDate(from)) / DAY_MS);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const d = new Date(parseIsoDate(date)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Bogotá wall-clock date + 'HH:MM' to an instant. */
export function bogotaInstant(date: IsoDate, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return new Date(parseIsoDate(date) + ((h - BOGOTA_OFFSET_HOURS) * 60 + m) * 60 * 1000);
}

/** The Bogotá calendar date of an instant. */
export function bogotaDate(instant: Date): IsoDate {
  return formatIsoDate(instant.getTime() + BOGOTA_OFFSET_HOURS * 60 * 60 * 1000);
}
