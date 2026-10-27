import { describe, expect, it } from 'vitest';
import {
  balances,
  blockForDate,
  bogotaDate,
  bogotaInstant,
  findOverlaps,
  generateBlocks,
  isLocked,
  ledgerEffect,
  locksAt,
  occurrences,
  programForGeneralMakeup,
  stateAtLock,
  studentCanNotify,
  type LedgerEntry,
} from './index';

describe('blocks', () => {
  it('splits the 2026-2 term into 4-week blocks from its start', () => {
    const blocks = generateBlocks('2026-07-06', '2026-12-20');
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toEqual({ number: 1, startsOn: '2026-07-06', endsOn: '2026-08-02' });
    expect(blocks[4]).toEqual({ number: 5, startsOn: '2026-10-26', endsOn: '2026-11-22' });
    expect(blocks[5]?.endsOn).toBe('2026-12-20');
  });

  it('cuts the last block at the term end', () => {
    const blocks = generateBlocks('2026-07-13', '2026-12-18');
    expect(blocks.at(-1)).toEqual({ number: 6, startsOn: '2026-11-30', endsOn: '2026-12-18' });
  });

  it('finds the block for a date', () => {
    const blocks = generateBlocks('2026-07-06', '2026-12-20');
    expect(blockForDate(blocks, '2026-10-27')?.number).toBe(5);
    expect(blockForDate(blocks, '2027-01-10')).toBeUndefined();
  });
});

describe('Bogotá time', () => {
  it('converts wall clock to an instant at UTC-5', () => {
    expect(bogotaInstant('2026-11-03', '18:30').toISOString()).toBe('2026-11-03T23:30:00.000Z');
    expect(bogotaDate(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-03');
  });
});

describe('24h rules', () => {
  const start = bogotaInstant('2026-11-03', '18:30');
  const end = bogotaInstant('2026-11-03', '19:30');

  it('locks 24 hours after the session ends', () => {
    expect(locksAt(end).toISOString()).toBe('2026-11-05T00:30:00.000Z');
    expect(isLocked(end, bogotaInstant('2026-11-04', '19:29'))).toBe(false);
    expect(isLocked(end, bogotaInstant('2026-11-04', '19:30'))).toBe(true);
  });

  it('accepts a student notice only until 24 hours before the start', () => {
    expect(studentCanNotify(start, bogotaInstant('2026-11-02', '18:30'))).toBe(true);
    expect(studentCanNotify(start, bogotaInstant('2026-11-02', '18:31'))).toBe(false);
  });

  it('turns unmarked into Falta at the lock', () => {
    expect(stateAtLock(null)).toBe('absent');
    expect(stateAtLock('present')).toBe('present');
  });
});

describe('repositions', () => {
  it('credits a notice and debits a makeup', () => {
    expect(ledgerEffect(null, 'excused')).toEqual([{ delta: 1, reason: 'notice' }]);
    expect(ledgerEffect('excused', 'absent')).toEqual([{ delta: -1, reason: 'reversal' }]);
    expect(ledgerEffect(null, 'makeup')).toEqual([{ delta: -1, reason: 'makeup' }]);
    expect(ledgerEffect('present', 'absent')).toEqual([]);
  });

  it('allows a negative balance when the reposition comes first', () => {
    const at = (d: string) => new Date(`${d}T12:00:00Z`);
    const entries: LedgerEntry[] = [
      { programId: 'en-rouge', delta: -1, reason: 'makeup', createdAt: at('2026-11-01') },
      { programId: 'at-my-house', delta: 1, reason: 'notice', createdAt: at('2026-11-02') },
    ];
    expect(balances(entries).get('en-rouge')).toBe(-1);
    expect(balances(entries).get('at-my-house')).toBe(1);
  });

  it('charges a general-clase reposition to the program of the last notice', () => {
    const at = (d: string) => new Date(`${d}T12:00:00Z`);
    const entries: LedgerEntry[] = [
      { programId: 'en-rouge', delta: 1, reason: 'notice', createdAt: at('2026-10-01') },
      { programId: 'at-my-house', delta: 1, reason: 'notice', createdAt: at('2026-10-20') },
      { programId: 'en-rouge', delta: 1, reason: 'cancellation', createdAt: at('2026-10-25') },
    ];
    expect(programForGeneralMakeup(entries)).toBe('at-my-house');
    expect(programForGeneralMakeup([])).toBeNull();
  });
});

describe('schedule', () => {
  const term = { validFrom: '2026-07-06', validTo: '2026-12-20' };

  it('flags Skill and Out against Female Dancehall on Monday', () => {
    const clashes = findOverlaps([
      { courseId: 'skill-and-out', ...term, slots: [{ weekday: 1, startsAt: '18:00', endsAt: '19:30' }] },
      { courseId: 'female-dancehall', ...term, slots: [{ weekday: 1, startsAt: '18:30', endsAt: '19:30' }] },
      { courseId: 'dancehall-mixto', ...term, slots: [{ weekday: 1, startsAt: '19:30', endsAt: '20:30' }] },
    ]);
    expect(clashes).toEqual([['skill-and-out', 'female-dancehall']]);
  });

  it('ignores clases whose dates never meet', () => {
    const clashes = findOverlaps([
      { courseId: 'a', validFrom: '2026-11-01', validTo: '2026-11-30', slots: [{ weekday: 2, startsAt: '09:00', endsAt: '11:00' }] },
      { courseId: 'b', validFrom: '2026-12-01', validTo: '2026-12-20', slots: [{ weekday: 2, startsAt: '09:00', endsAt: '11:00' }] },
    ]);
    expect(clashes).toEqual([]);
  });

  it('lists the dates of a weekly slot', () => {
    expect(occurrences(1, '2026-07-06', '2026-07-27')).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ]);
    expect(occurrences(3, '2026-07-06', '2026-07-12')).toEqual(['2026-07-08']);
  });
});
