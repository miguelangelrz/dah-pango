import { describe, expect, it } from 'vitest';
import {
  addPersonProblem,
  bogotaInstant,
  canTakeAttendanceFor,
  enrolledOn,
  ledgerProgram,
  markProblem,
  writeSource,
  type SessionTiming,
} from './index';

// Wednesday 4 November 2026, 18:00–19:00 in Bogotá.
const session: SessionTiming = {
  startsAt: bogotaInstant('2026-11-04', '18:00'),
  endsAt: bogotaInstant('2026-11-04', '19:00'),
  status: 'scheduled',
};

describe('markProblem', () => {
  it('allows only Falta con aviso before the session starts', () => {
    const sameDayEarlier = bogotaInstant('2026-11-04', '17:59');
    expect(markProblem(session, 'enrolled', 'excused', sameDayEarlier)).toBeNull();
    expect(markProblem(session, 'enrolled', 'present', sameDayEarlier)).toMatch(/todavía no empieza/);
  });

  it('allows every state from the start of the session until the lock', () => {
    expect(markProblem(session, 'enrolled', 'present', bogotaInstant('2026-11-04', '18:00'))).toBeNull();
    expect(markProblem(session, 'enrolled', 'absent', bogotaInstant('2026-11-05', '18:59'))).toBeNull();
    expect(markProblem(session, 'enrolled', 'absent', bogotaInstant('2026-11-05', '19:00'))).toMatch(/se cerró/);
  });

  it('keeps each origin to its own states', () => {
    const now = bogotaInstant('2026-11-04', '18:30');
    expect(markProblem(session, 'makeup', 'makeup', now)).toBeNull();
    expect(markProblem(session, 'makeup', 'present', now)).toMatch(/no aplica/);
    expect(markProblem(session, 'walk_in', 'absent', now)).toMatch(/visitante/);
    expect(markProblem(session, 'enrolled', 'makeup', now)).toMatch(/inscrito/);
  });

  it('refuses cancelled and rescheduled sessions', () => {
    const now = bogotaInstant('2026-11-04', '18:30');
    expect(markProblem({ ...session, status: 'cancelled' }, 'enrolled', 'present', now)).toMatch(/cancelada/);
    expect(markProblem({ ...session, status: 'rescheduled' }, 'enrolled', 'present', now)).toMatch(/otra fecha/);
  });
});

describe('addPersonProblem', () => {
  it('lets makeups and walk-ins join only once the session started and before the lock', () => {
    expect(addPersonProblem(session, bogotaInstant('2026-11-04', '17:50'))).toMatch(/cuando empieza la clase/);
    expect(addPersonProblem(session, bogotaInstant('2026-11-04', '18:10'))).toBeNull();
    expect(addPersonProblem(session, bogotaInstant('2026-11-06', '18:10'))).toMatch(/se cerró/);
  });
});

describe('who takes attendance', () => {
  it('is the session teacher, or any director or super admin', () => {
    expect(canTakeAttendanceFor(['teacher'], 'ana', 'ana')).toBe(true);
    expect(canTakeAttendanceFor(['teacher'], 'ana', 'luis')).toBe(false);
    expect(canTakeAttendanceFor(['director', 'teacher'], 'jose', 'guest')).toBe(true);
    expect(canTakeAttendanceFor(['admin'], 'miguel', 'luis')).toBe(true);
    expect(canTakeAttendanceFor(['student'], 'ana', 'ana')).toBe(false);
  });

  it('logs a director covering someone else as director', () => {
    expect(writeSource(['director', 'teacher'], 'jose', 'guest')).toBe('director');
    expect(writeSource(['director', 'teacher'], 'jose', 'jose')).toBe('teacher');
    expect(writeSource(['teacher'], 'ana', 'ana')).toBe('teacher');
  });
});

describe('enrolledOn', () => {
  const course = { id: 'funcional', trackIds: ['coreo-funcional', 'otra'] };
  const enrollments = [
    { studentId: 'a', trackId: 'coreo-funcional', courseId: null, validFrom: '2026-07-06', validTo: '2026-12-20' },
    { studentId: 'a', trackId: 'otra', courseId: null, validFrom: '2026-07-06', validTo: '2026-12-20' },
    { studentId: 'b', trackId: null, courseId: 'funcional', validFrom: '2026-11-05', validTo: '2026-12-20' },
    { studentId: 'c', trackId: 'coreo-funcional', courseId: null, validFrom: '2026-07-06', validTo: '2026-09-30' },
    { studentId: 'd', trackId: null, courseId: 'house', validFrom: '2026-07-06', validTo: '2026-12-20' },
  ];

  it('lists each student once, through a línea or the clase itself, on the day', () => {
    expect(enrolledOn(enrollments, course, '2026-11-04')).toEqual(['a']);
    expect(enrolledOn(enrollments, course, '2026-11-05').sort()).toEqual(['a', 'b']);
    expect(enrolledOn(enrollments, course, '2026-09-30').sort()).toEqual(['a', 'c']);
  });
});

describe('ledgerProgram', () => {
  const notice = (programId: string, day: number) => ({
    programId,
    delta: 1 as const,
    reason: 'notice' as const,
    createdAt: new Date(2026, 9, day),
  });

  it('uses the clase programa when it has one', () => {
    expect(ledgerProgram('en-rouge', [notice('amh', 3)], [])).toBe('en-rouge');
  });

  it('settles the latest Falta con aviso in a general clase, then the first enrolled programa', () => {
    expect(ledgerProgram(null, [notice('amh', 3), notice('en-rouge', 9)], ['amh'])).toBe('en-rouge');
    expect(ledgerProgram(null, [], ['amh', 'en-rouge'])).toBe('amh');
    expect(ledgerProgram(null, [], [])).toBeNull();
  });
});
