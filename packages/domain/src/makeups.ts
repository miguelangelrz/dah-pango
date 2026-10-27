export interface LedgerEntry {
  programId: string;
  delta: 1 | -1;
  reason: 'notice' | 'cancellation' | 'makeup' | 'reversal';
  createdAt: Date;
}

/** Balance per program; it can be negative because a reposition can come before the miss. */
export function balances(entries: LedgerEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) out.set(e.programId, (out.get(e.programId) ?? 0) + e.delta);
  return out;
}

/**
 * A reposition taken in a general academy clase (no program) settles the most recent
 * credit: it counts against the program of the student's last Falta con aviso.
 * Returns null when the student has never had one; a director then picks the program.
 */
export function programForGeneralMakeup(entries: LedgerEntry[]): string | null {
  const notices = entries
    .filter((e) => e.reason === 'notice' && e.delta === 1)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return notices[0]?.programId ?? null;
}
