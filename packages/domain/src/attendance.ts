export const ATTENDANCE_STATES = ['present', 'absent', 'excused', 'makeup'] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export const ATTENDANCE_ORIGINS = ['enrolled', 'makeup', 'walk_in'] as const;
export type AttendanceOrigin = (typeof ATTENDANCE_ORIGINS)[number];

/** Spanish labels shown in the app. */
export const ATTENDANCE_LABELS: Record<AttendanceState, string> = {
  present: 'Asistió',
  absent: 'Falta',
  excused: 'Falta con aviso',
  makeup: 'Reposición',
};

const HOUR_MS = 60 * 60 * 1000;
export const LOCK_AFTER_HOURS = 24;
export const NOTICE_BEFORE_HOURS = 24;

/** Attendance locks 24 hours after the session ends. */
export function locksAt(sessionEndsAt: Date): Date {
  return new Date(sessionEndsAt.getTime() + LOCK_AFTER_HOURS * HOUR_MS);
}

export function isLocked(sessionEndsAt: Date, now: Date): boolean {
  return now.getTime() >= locksAt(sessionEndsAt).getTime();
}

/** Students can notify an absence in the app until 24 hours before the session starts. */
export function studentCanNotify(sessionStartsAt: Date, now: Date): boolean {
  return now.getTime() <= sessionStartsAt.getTime() - NOTICE_BEFORE_HOURS * HOUR_MS;
}

/** States allowed for each way a person got on the list. */
export function allowedStates(origin: AttendanceOrigin): AttendanceState[] {
  switch (origin) {
    case 'enrolled':
      return ['present', 'absent', 'excused'];
    case 'makeup':
      return ['makeup', 'absent'];
    case 'walk_in':
      return ['present'];
  }
}

/** Walk-ins are marked present on arrival; makeups start as Reposición. */
export function initialState(origin: AttendanceOrigin): AttendanceState | null {
  if (origin === 'walk_in') return 'present';
  if (origin === 'makeup') return 'makeup';
  return null;
}

/** At the lock, anyone still unmarked becomes Falta. */
export function stateAtLock(current: AttendanceState | null): AttendanceState {
  return current ?? 'absent';
}

export type LedgerReason = 'notice' | 'cancellation' | 'makeup' | 'reversal';

/** Reposition ledger rows a state change produces (credit for a notice, debit for a makeup). */
export function ledgerEffect(
  from: AttendanceState | null,
  to: AttendanceState,
): { delta: 1 | -1; reason: LedgerReason }[] {
  const effects: { delta: 1 | -1; reason: LedgerReason }[] = [];
  if (from !== 'excused' && to === 'excused') effects.push({ delta: 1, reason: 'notice' });
  if (from === 'excused' && to !== 'excused') effects.push({ delta: -1, reason: 'reversal' });
  if (from !== 'makeup' && to === 'makeup') effects.push({ delta: -1, reason: 'makeup' });
  if (from === 'makeup' && to !== 'makeup') effects.push({ delta: 1, reason: 'reversal' });
  return effects;
}
