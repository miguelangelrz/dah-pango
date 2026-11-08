import { describe, expect, it } from 'vitest';
import {
  bogotaInstant,
  changeDateProblem,
  clashesWith,
  dateInTermProblem,
  lastDayBefore,
  makeupRequestProblem,
  noticeProblem,
  reviewProblem,
  withdrawProblem,
  type SessionTiming,
} from './index';

// Wednesday 4 November 2026, 18:00–19:00 in Bogotá.
const session: SessionTiming = {
  startsAt: bogotaInstant('2026-11-04', '18:00'),
  endsAt: bogotaInstant('2026-11-04', '19:00'),
  status: 'scheduled',
};
const enrolled = { origin: 'enrolled' as const, state: null };

describe('noticeProblem', () => {
  it('takes notices until 24 hours before the session', () => {
    expect(noticeProblem(session, enrolled, bogotaInstant('2026-11-03', '18:00'))).toBeNull();
    expect(noticeProblem(session, enrolled, bogotaInstant('2026-11-03', '18:01'))).toMatch(/24 horas/);
  });

  it('is only for enrolled students without a mark', () => {
    const early = bogotaInstant('2026-11-01', '10:00');
    expect(noticeProblem(session, null, early)).toMatch(/No estás inscrito/);
    expect(noticeProblem(session, { origin: 'makeup', state: null }, early)).toMatch(/No estás inscrito/);
    expect(noticeProblem(session, { origin: 'enrolled', state: 'excused' }, early)).toMatch(/Ya avisaste/);
    expect(noticeProblem({ ...session, status: 'cancelled' }, enrolled, early)).toMatch(/cancelada/);
  });
});

describe('makeupRequestProblem', () => {
  const base = {
    session,
    now: bogotaInstant('2026-11-04', '12:00'),
    sessionProgramId: 'rouge',
    studentProgramIds: ['rouge'],
    alreadyListed: false,
  };

  it('allows the same programa or a general clase', () => {
    expect(makeupRequestProblem(base)).toBeNull();
    expect(makeupRequestProblem({ ...base, sessionProgramId: null, studentProgramIds: [] })).toBeNull();
    expect(makeupRequestProblem({ ...base, sessionProgramId: 'house' })).toMatch(/mismo programa/);
  });

  it('refuses sesiones that started or where the student already is', () => {
    expect(makeupRequestProblem({ ...base, now: bogotaInstant('2026-11-04', '18:00') })).toMatch(/ya empezó/);
    expect(makeupRequestProblem({ ...base, alreadyListed: true })).toMatch(/Ya estás/);
    expect(makeupRequestProblem({ ...base, session: { ...session, status: 'cancelled' } })).toMatch(/programada/);
  });
});

describe('enrollment dates', () => {
  const term = { startsOn: '2026-07-06', endsOn: '2026-12-20' };

  it('keeps dates inside the semestre', () => {
    expect(dateInTermProblem(term, '2026-07-06')).toBeNull();
    expect(dateInTermProblem(term, '2026-12-21')).toMatch(/semestre/);
  });

  it('starts changes today at the earliest', () => {
    expect(changeDateProblem(term, '2026-11-08', '2026-11-08')).toBeNull();
    expect(changeDateProblem(term, '2026-11-07', '2026-11-08')).toMatch(/antes de hoy/);
    expect(changeDateProblem(term, '2027-01-10', '2026-11-08')).toMatch(/semestre/);
  });

  it('ends an inscripción the day before the change', () => {
    const e = { validFrom: '2026-07-06', validTo: '2026-12-20' };
    expect(lastDayBefore(e, '2026-11-09')).toEqual({ lastDay: '2026-11-08' });
    expect(lastDayBefore(e, '2026-07-06')).toEqual({ problem: expect.stringMatching(/después del inicio/) });
    expect(lastDayBefore({ ...e, validTo: '2026-10-01' }, '2026-11-09')).toEqual({ problem: expect.stringMatching(/ya termina/) });
  });
});

describe('clashesWith', () => {
  const window = { validFrom: '2026-07-06', validTo: '2026-12-20' };
  const mine = [{ courseId: 'funcional', slots: [{ weekday: 1, startsAt: '18:00', endsAt: '19:00' }], ...window }];

  it('names the clases a new one overlaps', () => {
    const house = { courseId: 'house', slots: [{ weekday: 1, startsAt: '18:30', endsAt: '19:30' }], ...window };
    const later = { courseId: 'hiphop', slots: [{ weekday: 1, startsAt: '19:00', endsAt: '20:00' }], ...window };
    expect(clashesWith(mine, [house])).toEqual(['funcional']);
    expect(clashesWith(mine, [later])).toEqual([]);
  });

  it('ignores clashes inside the new línea and windows that don’t meet', () => {
    const a = { courseId: 'a', slots: [{ weekday: 2, startsAt: '18:00', endsAt: '19:00' }], ...window };
    const b = { courseId: 'b', slots: [{ weekday: 2, startsAt: '18:30', endsAt: '19:30' }], ...window };
    expect(clashesWith(mine, [a, b])).toEqual([]);
    const after = { ...mine[0]!, courseId: 'x', validFrom: '2026-12-01' };
    expect(clashesWith([{ ...mine[0]!, validTo: '2026-11-30' }], [after])).toEqual([]);
  });
});

describe('review and withdraw', () => {
  it('reviews only pending requests', () => {
    expect(reviewProblem('pending')).toBeNull();
    expect(reviewProblem('approved')).toMatch(/aprobada/);
  });

  it('lets a student take back a pending request or an approved makeup before the clase', () => {
    const now = bogotaInstant('2026-11-04', '12:00');
    expect(withdrawProblem('pending')).toBeNull();
    expect(withdrawProblem('approved')).toMatch(/ya no/);
    expect(withdrawProblem('approved', { startsAt: session.startsAt, marked: false, now })).toBeNull();
    expect(withdrawProblem('approved', { startsAt: session.startsAt, marked: true, now })).toMatch(/ya no/);
  });
});
