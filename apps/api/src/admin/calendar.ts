import type { SessionSyncSummary } from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  addDays,
  blockForDate,
  bogotaInstant,
  courseRangeInTerm,
  planSessions,
  syncSessions,
  type DateRange,
  type ExistingSession,
  type WeeklySlot,
} from '@dah-pango/domain';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';

// Keeps the generated sesiones in line with the semestre, its bloques and each clase's
// weekly slots. Only sesiones that haven't started change, so history stays as it was.

/** A rule broken by the request: the route answers with this status and message. */
export class Problem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Term = typeof schema.term.$inferSelect;
type Course = typeof schema.course.$inferSelect;

export const emptySummary = (): SessionSyncSummary => ({ created: 0, updated: 0, removed: 0, kept: 0 });

export function addSummaries(a: SessionSyncSummary, b: SessionSyncSummary): SessionSyncSummary {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    removed: a.removed + b.removed,
    kept: a.kept + b.kept,
  };
}

/** Ids, among the given sesiones, that attendance, notices, makeups, the ledger or a handoff point at. */
async function sessionsWithRecords(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const lists = await Promise.all([
    db.selectDistinct({ id: schema.attendance.sessionId }).from(schema.attendance).where(inArray(schema.attendance.sessionId, ids)),
    db.selectDistinct({ id: schema.absenceNotice.sessionId }).from(schema.absenceNotice).where(inArray(schema.absenceNotice.sessionId, ids)),
    db.selectDistinct({ id: schema.makeupRequest.sessionId }).from(schema.makeupRequest).where(inArray(schema.makeupRequest.sessionId, ids)),
    db.selectDistinct({ id: schema.makeupLedger.sessionId }).from(schema.makeupLedger).where(inArray(schema.makeupLedger.sessionId, ids)),
    db.selectDistinct({ id: schema.sessionHandoff.sessionId }).from(schema.sessionHandoff).where(inArray(schema.sessionHandoff.sessionId, ids)),
  ]);
  return new Set(lists.flat().map((r) => r.id));
}

async function rescheduleTargets(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.session.rescheduledTo })
    .from(schema.session)
    .where(inArray(schema.session.rescheduledTo, ids));
  return new Set(rows.map((r) => r.id).filter((id): id is string => id !== null));
}

export async function syncCourseSessions(
  db: Db,
  term: Term,
  course: Course,
  slots: WeeklySlot[],
  now: Date,
): Promise<SessionSyncSummary> {
  if (course.kind !== 'weekly') return emptySummary();

  const rows = await db
    .select()
    .from(schema.session)
    .where(and(eq(schema.session.courseId, course.id), eq(schema.session.termId, term.id)));
  const upcoming = rows.filter((r) => r.startsAt > now).map((r) => r.id);
  const [withRecords, targets] = await Promise.all([
    sessionsWithRecords(db, upcoming),
    rescheduleTargets(db, upcoming),
  ]);
  const existing: ExistingSession[] = rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status as ExistingSession['status'],
    hasRecords: withRecords.has(r.id),
    isRescheduleTarget: targets.has(r.id),
  }));

  const planned = planSessions(slots, courseRangeInTerm(term, course));
  const sync = syncSessions(existing, planned, now);

  if (sync.create.length > 0) {
    if (!course.defaultTeacherId) {
      throw new Problem(409, `«${course.title}» no tiene profe asignado, así que no se le pueden crear sesiones`);
    }
    const blocks = await db.select().from(schema.block).where(eq(schema.block.termId, term.id));
    await db.insert(schema.session).values(
      sync.create.map((p) => ({
        courseId: course.id,
        termId: term.id,
        blockId: blocks.find((b) => b.number === blockForDate(blocks, p.date)?.number)?.id ?? null,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        teacherId: course.defaultTeacherId!,
        modality: course.modality,
      })),
    );
  }
  for (const u of sync.update) {
    await db.update(schema.session).set({ endsAt: u.endsAt }).where(eq(schema.session.id, u.id));
  }
  if (sync.remove.length > 0) {
    await db.delete(schema.session).where(inArray(schema.session.id, sync.remove));
  }
  return {
    created: sync.create.length,
    updated: sync.update.length,
    removed: sync.remove.length,
    kept: sync.keep.length,
  };
}

export async function slotsOf(db: Db, courseId: string): Promise<WeeklySlot[]> {
  return db
    .select({ weekday: schema.courseSlot.weekday, startsAt: schema.courseSlot.startsAt, endsAt: schema.courseSlot.endsAt })
    .from(schema.courseSlot)
    .where(eq(schema.courseSlot.courseId, courseId))
    .orderBy(asc(schema.courseSlot.weekday), asc(schema.courseSlot.startsAt));
}

/** Brings every weekly clase's sesiones in a semestre in line with its slots. */
export async function syncTermSessions(db: Db, term: Term, now: Date): Promise<SessionSyncSummary> {
  const courses = await db.select().from(schema.course).where(eq(schema.course.kind, 'weekly'));
  let summary = emptySummary();
  for (const course of courses) {
    summary = addSummaries(summary, await syncCourseSessions(db, term, course, await slotsOf(db, course.id), now));
  }
  return summary;
}

/** Replaces a semestre's bloques and points each of its sesiones at the bloque of its date. */
export async function replaceBlocks(db: Db, termId: string, blocks: (DateRange & { number: number })[]) {
  await db.update(schema.session).set({ blockId: null }).where(eq(schema.session.termId, termId));
  await db.delete(schema.block).where(eq(schema.block.termId, termId));
  const rows = await db
    .insert(schema.block)
    .values(blocks.map((b) => ({ termId, number: b.number, startsOn: b.startsOn, endsOn: b.endsOn })))
    .returning();
  for (const b of rows) {
    await db
      .update(schema.session)
      .set({ blockId: b.id })
      .where(
        and(
          eq(schema.session.termId, termId),
          gte(schema.session.startsAt, bogotaInstant(b.startsOn, '00:00')),
          lt(schema.session.startsAt, bogotaInstant(addDays(b.endsOn, 1), '00:00')),
        ),
      );
  }
  return rows;
}
