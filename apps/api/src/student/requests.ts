import type { EnrollmentRequest } from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  changeDateProblem,
  ENROLLMENT_ACTION_LABELS,
  lastDayBefore,
  makeupRequestProblem,
  type IsoDate,
} from '@dah-pango/domain';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { Problem } from '../admin/calendar';
import { programForSession, rostersOf, type LoadedSession } from '../attendance/service';
import { clashTitles, programIdsOf, scheduleOf, type Catalog } from './service';

// The checks behind a request, run when the student sends it and again when a director
// approves it (things may have changed in between), and the writes an approval makes.

type TermRow = typeof schema.term.$inferSelect;
type EnrollmentRow = typeof schema.enrollment.$inferSelect;

export interface EnrollmentPlan {
  start: IsoDate;
  /** The inscripción to close, and its new last day. */
  close: { enrollment: EnrollmentRow; lastDay: IsoDate } | null;
  /** The línea or clase to open from `start` to the end of the semestre. */
  open: { trackId: string | null; courseId: string | null } | null;
}

/** Throws a Problem (in Spanish) when the change can't happen from `start`. */
export async function planEnrollmentChange(
  db: Db,
  cat: Catalog,
  term: TermRow,
  studentId: string,
  request: Pick<EnrollmentRequest, 'action' | 'trackId' | 'courseId' | 'replacesEnrollmentId'>,
  start: IsoDate,
  today: IsoDate,
): Promise<EnrollmentPlan> {
  const dateProblem = changeDateProblem(term, start, today);
  if (dateProblem) throw new Problem(409, dateProblem);

  const mine = await db
    .select()
    .from(schema.enrollment)
    .where(
      and(
        eq(schema.enrollment.studentId, studentId),
        eq(schema.enrollment.termId, term.id),
        isNull(schema.enrollment.closedByChange),
        gte(schema.enrollment.validTo, start),
      ),
    );

  let close: EnrollmentPlan['close'] = null;
  if (request.action !== 'join') {
    const old = mine.find((e) => e.id === request.replacesEnrollmentId);
    if (!old) throw new Problem(404, 'No encontramos esa inscripción, o ya terminó');
    const end = lastDayBefore(old, start);
    if ('problem' in end) throw new Problem(409, end.problem);
    close = { enrollment: old, lastDay: end.lastDay };
  }

  let open: EnrollmentPlan['open'] = null;
  if (request.action !== 'leave') {
    const target = { trackId: request.trackId ?? null, courseId: request.courseId ?? null };
    if (target.trackId) {
      const track = cat.tracks.find((t) => t.id === target.trackId);
      if (!track || !track.active) throw new Problem(404, 'No encontramos esa línea');
    } else {
      const course = cat.courses.find((c) => c.id === target.courseId);
      if (!course || course.kind !== 'weekly') throw new Problem(404, 'No encontramos esa clase');
    }
    const others = mine.filter((e) => e.id !== close?.enrollment.id);
    if (others.some((e) => (target.trackId && e.trackId === target.trackId) || (target.courseId && e.courseId === target.courseId))) {
      throw new Problem(409, 'Ya estás inscrito ahí');
    }
    if (close && ((target.trackId && close.enrollment.trackId === target.trackId) || (target.courseId && close.enrollment.courseId === target.courseId))) {
      throw new Problem(409, 'Elige una línea o clase distinta a la que tienes');
    }
    const clashes = clashTitles(cat, others, scheduleOf(cat, target, { validFrom: start, validTo: term.endsOn }));
    if (clashes.length > 0) throw new Problem(409, `Se cruza en horario con ${clashes.join(', ')}`);
    open = target;
  }
  return { start, close, open };
}

/** Writes an approved (or direct) change: one enrollment_change, the inscripción closed and/or opened. */
export async function applyEnrollmentChange(
  db: Db,
  term: TermRow,
  studentId: string,
  plan: EnrollmentPlan,
  by: { madeBy: string; requestId: string | null; reason: keyof typeof ENROLLMENT_ACTION_LABELS; now: Date },
) {
  const [change] = await db
    .insert(schema.enrollmentChange)
    .values({
      studentId,
      requestId: by.requestId,
      effectiveOn: plan.start,
      reason: ENROLLMENT_ACTION_LABELS[by.reason],
      madeBy: by.madeBy,
      madeAt: by.now,
    })
    .returning();
  if (plan.close) {
    await db
      .update(schema.enrollment)
      .set({ validTo: plan.close.lastDay, closedByChange: change!.id })
      .where(eq(schema.enrollment.id, plan.close.enrollment.id));
  }
  if (plan.open) {
    await db.insert(schema.enrollment).values({
      studentId,
      termId: term.id,
      trackId: plan.open.trackId,
      courseId: plan.open.courseId,
      validFrom: plan.start,
      validTo: term.endsOn,
      openedByChange: change!.id,
    });
  }
}

/** Checks a reposición in this sesión and returns the programa it counts against. */
export async function checkMakeup(
  db: Db,
  cat: Catalog,
  loaded: LoadedSession,
  studentId: string,
  now: Date,
): Promise<string> {
  const { session } = loaded;
  const [roster, enrollments] = await Promise.all([
    rostersOf(db, [session]).then((r) => r.get(session.id) ?? []),
    db
      .select()
      .from(schema.enrollment)
      .where(and(eq(schema.enrollment.studentId, studentId), eq(schema.enrollment.termId, session.termId))),
  ]);
  const problem = makeupRequestProblem({
    session: { startsAt: session.startsAt, endsAt: session.endsAt, status: session.status as 'scheduled' },
    now,
    sessionProgramId: loaded.course.programId,
    studentProgramIds: programIdsOf(cat, enrollments),
    alreadyListed: roster.some((r) => r.personId === studentId),
  });
  if (problem) throw new Problem(409, problem);
  const programId = await programForSession(db, loaded, studentId);
  if (!programId) throw new Problem(409, 'No sabemos a qué programa cargar esta reposición. Habla con dirección.');
  return programId;
}
