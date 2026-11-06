import { describe, expect, it } from 'vitest';
import {
  blocksProblem,
  bogotaInstant,
  can,
  courseRangeInTerm,
  generateBlocks,
  isSuperAdmin,
  permissionsOf,
  planSessions,
  slotDurationMinutes,
  slotFromDuration,
  slotsProblem,
  syncSessions,
  termProblem,
  type ExistingSession,
} from './index';

const term = { startsOn: '2026-07-06', endsOn: '2026-12-20' };

describe('permissions', () => {
  it('lets directors and super admins do everything', () => {
    expect(isSuperAdmin([{ role: 'director' }])).toBe(true);
    expect(isSuperAdmin(['admin'])).toBe(true);
    expect(permissionsOf(['admin'])).toEqual(permissionsOf(['director']));
    expect(can(['admin'], 'configure_academy')).toBe(true);
  });

  it('keeps teachers and students to their own work', () => {
    expect(can(['teacher'], 'configure_academy')).toBe(false);
    expect(can(['teacher'], 'take_attendance')).toBe(true);
    expect(can(['student', 'teacher'], 'send_requests')).toBe(true);
    expect(isSuperAdmin([{ role: 'student' }, { role: 'teacher' }])).toBe(false);
    expect(permissionsOf([])).toEqual([]);
  });
});

describe('term and block rules', () => {
  it('rejects a term that ends before it starts or overlaps another', () => {
    expect(termProblem(term, [])).toBeNull();
    expect(termProblem({ startsOn: '2026-07-06', endsOn: '2026-07-01' }, [])).toMatch(/antes de empezar/);
    expect(termProblem(term, [{ startsOn: '2026-12-20', endsOn: '2027-06-01' }])).toMatch(/se cruzan/);
    expect(termProblem(term, [{ startsOn: '2027-01-12', endsOn: '2027-06-01' }])).toBeNull();
  });

  it('accepts generated blocks and blocks with a holiday gap', () => {
    expect(blocksProblem(term, generateBlocks(term.startsOn, term.endsOn))).toBeNull();
    expect(
      blocksProblem(term, [
        { number: 1, startsOn: '2026-07-06', endsOn: '2026-08-02' },
        { number: 2, startsOn: '2026-08-10', endsOn: '2026-09-06' },
      ]),
    ).toBeNull();
  });

  it('rejects blocks out of order, overlapping or outside the term', () => {
    expect(blocksProblem(term, [])).toMatch(/al menos un bloque/);
    expect(blocksProblem(term, [{ number: 2, startsOn: '2026-07-06', endsOn: '2026-08-02' }])).toMatch(/en orden/);
    expect(blocksProblem(term, [{ number: 1, startsOn: '2026-07-01', endsOn: '2026-08-02' }])).toMatch(/se sale/);
    expect(
      blocksProblem(term, [
        { number: 1, startsOn: '2026-07-06', endsOn: '2026-08-02' },
        { number: 2, startsOn: '2026-08-02', endsOn: '2026-08-30' },
      ]),
    ).toMatch(/empieza antes/);
  });
});

describe('weekly slots', () => {
  it('builds a slot from a start and a duration', () => {
    expect(slotFromDuration(3, '18:00', 60)).toEqual({ weekday: 3, startsAt: '18:00', endsAt: '19:00' });
    expect(slotFromDuration(1, '19:30:00', 90)).toEqual({ weekday: 1, startsAt: '19:30', endsAt: '21:00' });
    expect(slotFromDuration(1, '23:30', 60)).toBeNull();
    expect(slotDurationMinutes({ startsAt: '18:00:00', endsAt: '21:00:00' })).toBe(180);
  });

  it('rejects two slots of the same clase that overlap', () => {
    expect(slotsProblem([{ weekday: 1, startsAt: '18:00', endsAt: '19:30' }])).toBeNull();
    expect(
      slotsProblem([
        { weekday: 1, startsAt: '18:00', endsAt: '19:30' },
        { weekday: 1, startsAt: '19:00', endsAt: '20:00' },
      ]),
    ).toMatch(/se cruzan el lunes/);
    expect(
      slotsProblem([
        { weekday: 1, startsAt: '18:00', endsAt: '19:30' },
        { weekday: 1, startsAt: '19:30', endsAt: '20:00' },
      ]),
    ).toBeNull();
  });
});

describe('session planning', () => {
  it('plans every Wednesday of the term for a one-hour clase', () => {
    const planned = planSessions([{ weekday: 3, startsAt: '18:00:00', endsAt: '19:00:00' }], term);
    expect(planned[0]).toEqual({
      date: '2026-07-08',
      startsAt: bogotaInstant('2026-07-08', '18:00'),
      endsAt: bogotaInstant('2026-07-08', '19:00'),
    });
    expect(planned.at(-1)?.date).toBe('2026-12-16');
    expect(planned).toHaveLength(24);
  });

  it('cuts a clase with its own dates to the term', () => {
    expect(courseRangeInTerm(term, { startsOn: null, endsOn: null })).toEqual(term);
    expect(courseRangeInTerm(term, { startsOn: '2026-11-01', endsOn: '2026-11-30' })).toEqual({
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
    });
    expect(courseRangeInTerm(term, { startsOn: '2026-01-01', endsOn: '2027-01-01' })).toEqual(term);
  });

  const now = new Date('2026-11-06T15:00:00Z');
  const at = (date: string, time: string) => bogotaInstant(date, time);
  const existing = (date: string, start: string, end: string, extra: Partial<ExistingSession> = {}): ExistingSession => ({
    id: `${date} ${start}`,
    startsAt: at(date, start),
    endsAt: at(date, end),
    status: 'scheduled',
    hasRecords: false,
    isRescheduleTarget: false,
    ...extra,
  });

  it('only touches sesiones that have not started', () => {
    const before = [existing('2026-11-04', '18:00', '19:00'), existing('2026-11-11', '18:00', '19:00')];
    const planned = planSessions([{ weekday: 3, startsAt: '18:00', endsAt: '19:30' }], {
      startsOn: '2026-11-01',
      endsOn: '2026-11-18',
    });
    expect(syncSessions(before, planned, now)).toEqual({
      create: [planned[2]],
      update: [{ id: '2026-11-11 18:00', endsAt: at('2026-11-11', '19:30') }],
      remove: [],
      keep: [],
    });
  });

  it('moves a clase to another day, keeping sesiones that already have records', () => {
    const before = [
      existing('2026-11-11', '18:00', '19:00', { hasRecords: true }),
      existing('2026-11-18', '18:00', '19:00'),
      existing('2026-11-19', '10:00', '11:00', { isRescheduleTarget: true }),
      existing('2026-11-25', '18:00', '19:00', { status: 'cancelled' }),
    ];
    const planned = planSessions([{ weekday: 4, startsAt: '18:00', endsAt: '19:00' }], {
      startsOn: '2026-11-09',
      endsOn: '2026-11-22',
    });
    const sync = syncSessions(before, planned, now);
    expect(sync.create.map((p) => p.date)).toEqual(['2026-11-12', '2026-11-19']);
    expect(sync.remove).toEqual(['2026-11-18 18:00']);
    expect(sync.keep).toEqual(['2026-11-11 18:00']);
    expect(sync.update).toEqual([]);
  });

  it('does not recreate a cancelled sesión at the same time', () => {
    const before = [existing('2026-11-11', '18:00', '19:00', { status: 'cancelled' })];
    const planned = planSessions([{ weekday: 3, startsAt: '18:00', endsAt: '20:00' }], {
      startsOn: '2026-11-11',
      endsOn: '2026-11-11',
    });
    expect(syncSessions(before, planned, now)).toEqual({ create: [], update: [], remove: [], keep: [] });
  });
});
