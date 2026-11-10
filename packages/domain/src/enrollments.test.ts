import { describe, expect, it } from 'vitest';
import { clashesWith, closingValidTo, earliestLeaveOn, leaveOnProblem, planLeave } from './enrollments';
import { windowsOverlap } from './schedule';

const term = { validFrom: '2026-07-06', validTo: '2026-12-20' };
const monday = (startsAt: string, endsAt: string) => [{ weekday: 1, startsAt, endsAt }];

describe('clashesWith', () => {
  const mine = [
    { courseId: 'funcional', slots: monday('18:00', '19:00'), ...term },
    { courseId: 'house', slots: monday('19:00', '20:00'), ...term },
  ];

  it('names the clases a new one overlaps', () => {
    expect(clashesWith(mine, { courseId: 'hiphop', slots: monday('18:30', '19:30'), ...term })).toEqual([
      'funcional',
      'house',
    ]);
  });

  it('is empty when the new clase fits', () => {
    expect(clashesWith(mine, { courseId: 'hiphop', slots: monday('20:00', '21:00'), ...term })).toEqual([]);
  });

  it('ignores the clase itself', () => {
    expect(clashesWith(mine, { courseId: 'funcional', slots: monday('18:00', '19:00'), ...term })).toEqual([]);
  });
});

describe('closingValidTo', () => {
  it('ends a running inscripción on the last day', () => {
    expect(closingValidTo({ validFrom: '2026-07-06', validTo: '2026-12-20' }, '2026-11-09')).toBe('2026-11-09');
  });

  it('ends one that has not started the day before it starts', () => {
    expect(closingValidTo({ validFrom: '2026-11-16', validTo: '2026-12-20' }, '2026-11-09')).toBe('2026-11-15');
  });

  it('leaves alone one that already ends by then', () => {
    expect(closingValidTo({ validFrom: '2026-07-06', validTo: '2026-10-01' }, '2026-11-09')).toBeNull();
  });
});

describe('leaving a clase', () => {
  const today = '2026-11-10';
  const until = '2026-12-20';

  it('starts today, or tomorrow when today\'s sesión already started', () => {
    expect(earliestLeaveOn(today, false)).toBe(today);
    expect(earliestLeaveOn(today, true)).toBe('2026-11-11');
  });

  it('takes a date from then until the inscripción ends', () => {
    expect(leaveOnProblem(today, { today, startedToday: false, enrolledUntil: until })).toBeNull();
    expect(leaveOnProblem('2026-11-09', { today, startedToday: false, enrolledUntil: until })).toMatch(/antes de hoy/);
    expect(leaveOnProblem(today, { today, startedToday: true, enrolledUntil: until })).toMatch(/desde mañana/);
    expect(leaveOnProblem('2026-12-21', { today, startedToday: false, enrolledUntil: until })).toMatch(/final/);
  });

  it('closes a línea the day before and keeps its other clases from that date', () => {
    expect(planLeave({ validFrom: '2026-07-06', validTo: until }, '2026-11-17', ['house'])).toEqual({
      closeValidTo: '2026-11-16',
      keep: [{ courseId: 'house', validFrom: '2026-11-17', validTo: until }],
    });
  });

  it('keeps the other clases from the start of an inscripción that has not started', () => {
    expect(planLeave({ validFrom: '2026-11-20', validTo: until }, '2026-11-17', ['house'])).toEqual({
      closeValidTo: '2026-11-19',
      keep: [{ courseId: 'house', validFrom: '2026-11-20', validTo: until }],
    });
  });
});

describe('windowsOverlap', () => {
  it('never overlaps an inscripción closed before it started', () => {
    expect(windowsOverlap({ validFrom: '2026-11-16', validTo: '2026-11-15' }, term)).toBe(false);
  });
});
