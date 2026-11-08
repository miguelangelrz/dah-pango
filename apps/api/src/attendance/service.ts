import type { AttendanceSessionSummary, RosterRow } from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  bogotaDate,
  enrolledOn,
  isLocked,
  ledgerEffect,
  ledgerProgram,
  locksAt,
  type AttendanceOrigin,
  type AttendanceState,
  type LedgerEntry,
} from '@dah-pango/domain';
import { and, asc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { Problem } from '../admin/calendar';

// Reads and writes behind the attendance screens. Every write goes through `writeMark`,
// which keeps attendance, its event log and the repositions ledger in step.

export type SessionRow = typeof schema.session.$inferSelect;
type CourseRow = typeof schema.course.$inferSelect;

export interface LoadedSession {
  session: SessionRow;
  course: CourseRow;
  program: { id: string; name: string; accentColor: string | null } | null;
  teacher: { id: string; fullName: string; hasAccount: boolean };
}

export async function loadSessions(db: Db, where: SQL | undefined): Promise<LoadedSession[]> {
  const rows = await db
    .select({
      session: schema.session,
      course: schema.course,
      program: schema.program,
      teacher: schema.person,
      accountId: schema.account.personId,
    })
    .from(schema.session)
    .innerJoin(schema.course, eq(schema.course.id, schema.session.courseId))
    .leftJoin(schema.program, eq(schema.program.id, schema.course.programId))
    .innerJoin(schema.person, eq(schema.person.id, schema.session.teacherId))
    .leftJoin(schema.account, eq(schema.account.personId, schema.session.teacherId))
    .where(where)
    .orderBy(asc(schema.session.startsAt), asc(schema.course.title));
  return rows.map((r) => ({
    session: r.session,
    course: r.course,
    program: r.program ? { id: r.program.id, name: r.program.name, accentColor: r.program.accentColor } : null,
    teacher: { id: r.teacher.id, fullName: r.teacher.fullName, hasAccount: r.accountId !== null },
  }));
}

export async function loadSession(db: Db, id: string): Promise<LoadedSession | null> {
  const [row] = await loadSessions(db, eq(schema.session.id, id));
  return row ?? null;
}

export interface ListedPerson {
  personId: string;
  origin: AttendanceOrigin;
  state: AttendanceState | null;
  /** Set when a director approved this reposición ahead of the clase. */
  makeupRequestId: string | null;
}

/**
 * The list of each sesión: everyone enrolled on its day, approved reposiciones, plus anyone
 * with an attendance row (makeups, walk-ins, and students who left after being marked).
 */
export async function rostersOf(db: Db, sessions: SessionRow[]): Promise<Map<string, ListedPerson[]>> {
  const out = new Map<string, ListedPerson[]>();
  if (sessions.length === 0) return out;
  const courseIds = [...new Set(sessions.map((s) => s.courseId))];
  const termIds = [...new Set(sessions.map((s) => s.termId))];
  const sessionIds = sessions.map((s) => s.id);
  const [links, marks, makeups] = await Promise.all([
    db.select().from(schema.trackCourse).where(inArray(schema.trackCourse.courseId, courseIds)),
    db.select().from(schema.attendance).where(inArray(schema.attendance.sessionId, sessionIds)),
    db
      .select()
      .from(schema.makeupRequest)
      .where(and(inArray(schema.makeupRequest.sessionId, sessionIds), eq(schema.makeupRequest.status, 'approved'))),
  ]);
  const trackIds = [...new Set(links.map((l) => l.trackId))];
  const enrollments = await db
    .select()
    .from(schema.enrollment)
    .where(
      and(
        inArray(schema.enrollment.termId, termIds),
        trackIds.length > 0
          ? or(inArray(schema.enrollment.courseId, courseIds), inArray(schema.enrollment.trackId, trackIds))
          : inArray(schema.enrollment.courseId, courseIds),
      ),
    );

  for (const s of sessions) {
    const course = { id: s.courseId, trackIds: links.filter((l) => l.courseId === s.courseId).map((l) => l.trackId) };
    const enrolled = enrolledOn(
      enrollments.filter((e) => e.termId === s.termId),
      course,
      bogotaDate(s.startsAt),
    );
    const rows = marks.filter((m) => m.sessionId === s.id);
    const list: ListedPerson[] = rows.map((m) => ({
      personId: m.personId,
      origin: m.origin as AttendanceOrigin,
      state: m.state as AttendanceState,
      makeupRequestId: m.makeupRequestId,
    }));
    for (const id of enrolled) {
      if (!list.some((m) => m.personId === id)) {
        list.push({ personId: id, origin: 'enrolled', state: null, makeupRequestId: null });
      }
    }
    for (const r of makeups.filter((r) => r.sessionId === s.id)) {
      if (!list.some((m) => m.personId === r.studentId)) {
        list.push({ personId: r.studentId, origin: 'makeup', state: null, makeupRequestId: r.id });
      }
    }
    out.set(s.id, list);
  }
  return out;
}

export function summarize(
  loaded: LoadedSession,
  roster: ListedPerson[],
  meId: string,
  now: Date,
): AttendanceSessionSummary {
  const { session, course, program, teacher } = loaded;
  return {
    id: session.id,
    course: { id: course.id, title: course.title, style: course.style },
    program,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    locksAt: locksAt(session.endsAt).toISOString(),
    status: session.status as AttendanceSessionSummary['status'],
    locked: isLocked(session.endsAt, now),
    modality: session.modality as AttendanceSessionSummary['modality'],
    room: course.room,
    teacher,
    mine: teacher.id === meId,
    counts: { listed: roster.length, marked: roster.filter((r) => r.state !== null).length },
  };
}

export async function ledgerOf(db: Db, personId: string) {
  return db.select().from(schema.makeupLedger).where(eq(schema.makeupLedger.personId, personId));
}

/** Programas of the clases a student is enrolled in this semestre, directly or through a línea. */
export async function enrolledPrograms(db: Db, personId: string, termId: string): Promise<string[]> {
  const rows = await db
    .select({ track: schema.track.programId, course: schema.course.programId })
    .from(schema.enrollment)
    .leftJoin(schema.track, eq(schema.track.id, schema.enrollment.trackId))
    .leftJoin(schema.course, eq(schema.course.id, schema.enrollment.courseId))
    .where(and(eq(schema.enrollment.studentId, personId), eq(schema.enrollment.termId, termId)))
    .orderBy(asc(schema.enrollment.validFrom));
  return [...new Set(rows.map((r) => r.track ?? r.course).filter((p): p is string => p !== null))];
}

export const asEntries = (rows: (typeof schema.makeupLedger.$inferSelect)[]): LedgerEntry[] =>
  rows.map((r) => ({
    programId: r.programId,
    delta: r.delta as 1 | -1,
    reason: r.reason as LedgerEntry['reason'],
    createdAt: r.createdAt,
  }));

/** The programa a new credit or debit for this sesión counts against. */
export async function programForSession(db: Db, loaded: LoadedSession, personId: string): Promise<string | null> {
  if (loaded.course.programId) return loaded.course.programId;
  const [history, enrolled] = await Promise.all([
    ledgerOf(db, personId),
    enrolledPrograms(db, personId, loaded.session.termId),
  ]);
  return ledgerProgram(null, asEntries(history), enrolled);
}

/** Balance per programa for several people. */
export async function balancesOf(db: Db, personIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (personIds.length === 0) return out;
  const rows = await db
    .select({
      personId: schema.makeupLedger.personId,
      programId: schema.makeupLedger.programId,
      total: sql<number>`sum(${schema.makeupLedger.delta})::int`,
    })
    .from(schema.makeupLedger)
    .where(inArray(schema.makeupLedger.personId, personIds))
    .groupBy(schema.makeupLedger.personId, schema.makeupLedger.programId);
  for (const r of rows) {
    const m = out.get(r.personId) ?? new Map<string, number>();
    m.set(r.programId, Number(r.total));
    out.set(r.personId, m);
  }
  return out;
}

export interface MarkWrite {
  loaded: LoadedSession;
  personId: string;
  origin: AttendanceOrigin;
  from: AttendanceState | null;
  /** null removes the person from the list (only makeups and walk-ins). */
  to: AttendanceState | null;
  source: 'teacher' | 'director' | 'lock' | 'notice';
  makeupRequestId?: string | null;
  madeBy: string | null;
  now: Date;
}

/** One attendance write: the row, its event, and the ledger rows the change produces. */
export async function writeMark(db: Db, w: MarkWrite) {
  const { session } = w.loaded;
  const effects = w.to === null ? (w.from === 'makeup' ? [{ delta: 1 as const, reason: 'reversal' as const }] : []) : ledgerEffect(w.from, w.to);

  for (const effect of effects) {
    let programId: string | null;
    if (effect.reason === 'reversal') {
      // Undo against the programa the original credit or debit went to.
      const reverses = effect.delta === -1 ? 'notice' : 'makeup';
      const [original] = await db
        .select({ programId: schema.makeupLedger.programId })
        .from(schema.makeupLedger)
        .where(
          and(
            eq(schema.makeupLedger.personId, w.personId),
            eq(schema.makeupLedger.sessionId, session.id),
            eq(schema.makeupLedger.reason, reverses),
          ),
        )
        .orderBy(sql`${schema.makeupLedger.createdAt} desc`)
        .limit(1);
      programId = original?.programId ?? (await programForSession(db, w.loaded, w.personId));
    } else {
      programId = await programForSession(db, w.loaded, w.personId);
    }
    if (!programId) {
      throw new Problem(409, 'No sabemos a qué programa cargar esta reposición. La dirección debe revisarlo.');
    }
    await db.insert(schema.makeupLedger).values({
      personId: w.personId,
      programId,
      delta: effect.delta,
      reason: effect.reason,
      sessionId: session.id,
    });
  }

  if (w.to === null) {
    await db
      .delete(schema.attendance)
      .where(and(eq(schema.attendance.sessionId, session.id), eq(schema.attendance.personId, w.personId)));
  } else {
    const values = {
      state: w.to,
      origin: w.origin,
      markedBy: w.madeBy,
      markedAt: w.now,
      ...(w.makeupRequestId ? { makeupRequestId: w.makeupRequestId } : {}),
    };
    await db
      .insert(schema.attendance)
      .values({ sessionId: session.id, personId: w.personId, ...values })
      .onConflictDoUpdate({ target: [schema.attendance.sessionId, schema.attendance.personId], set: values });
  }
  await db.insert(schema.attendanceEvent).values({
    sessionId: session.id,
    personId: w.personId,
    oldState: w.from,
    newState: w.to,
    source: w.source,
    madeBy: w.madeBy,
    madeAt: w.now,
  });
}

/**
 * Closes a sesión whose lock time has passed: unmarked students become Falta, and the
 * sesión is stamped so the job doesn't visit it again. Cancelled or moved sesiones are
 * only stamped.
 */
export async function lockSession(db: Db, loaded: LoadedSession, now: Date) {
  const { session } = loaded;
  if (session.lockedAt || !isLocked(session.endsAt, now)) return;
  await db.transaction(async (tx) => {
    // The lock trigger lets this transaction write after the lock.
    await tx.execute(sql`select set_config('app.lock_job', 'on', true)`);
    if (session.status === 'scheduled') {
      const roster = (await rostersOf(tx, [session])).get(session.id) ?? [];
      for (const r of roster.filter((r) => r.state === null)) {
        await writeMark(tx, {
          loaded,
          personId: r.personId,
          origin: r.origin,
          from: null,
          to: 'absent',
          source: 'lock',
          madeBy: null,
          makeupRequestId: r.makeupRequestId,
          now,
        });
      }
    }
    await tx.update(schema.session).set({ lockedAt: now }).where(eq(schema.session.id, session.id));
  });
}

/** Locks every sesión that is due. The API runs it on a timer and before showing attendance. */
export async function lockDueSessions(db: Db, now: Date): Promise<number> {
  const due = await loadSessions(
    db,
    and(isNull(schema.session.lockedAt), lte(schema.session.endsAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))),
  );
  for (const loaded of due) await lockSession(db, loaded, now);
  return due.length;
}

export function documentOf(p: { documentType: string | null; documentNumber: string | null }): string | null {
  return p.documentType && p.documentNumber ? `${p.documentType} ${p.documentNumber}` : null;
}

export type { RosterRow };
