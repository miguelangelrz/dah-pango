import {
  joinRequestInput,
  leaveCourseInput,
  swapRequestInput,
  type CourseLeaveResult,
  type StudentEnrollmentRequest,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import { bogotaDate, bogotaInstant, leaveOnProblem, planLeave, type EnrollmentAction } from '@dah-pango/domain';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Problem } from '../admin/calendar';
import { parse } from '../auth/routes';
import {
  checkJoin,
  checkSwap,
  courseOptions,
  enrolledCourses,
  loadCourses,
  pendingRequests,
  requestsOf,
  startedToday,
  studentPrograms,
  type RequestContext,
  type RequestTarget,
} from './programs';
import { requireStudent } from './routes';
import { currentTerm } from './service';

// Mis programas: a student's clases per programa, the clases they could add, their requests
// to add or change a clase (a director approves them), and cancelling a clase from a date
// (no approval needed).

const isUuid = (id: string | undefined): id is string => z.uuid().safeParse(id).success;

/** Everything a student's change is checked against, for the semestre running today. */
async function contextOf(db: Db, studentId: string, now: Date): Promise<RequestContext | null> {
  const today = bogotaDate(now);
  const term = await currentTerm(db, today);
  if (!term) return null;
  const loaded = await loadCourses(db);
  const [mine, pending] = await Promise.all([
    enrolledCourses(db, loaded, studentId, term.id, today),
    pendingRequests(db, studentId, term.id),
  ]);
  return { loaded, mine, pending, term, today };
}

function sendProblem(reply: FastifyReply, err: unknown) {
  if (err instanceof Problem) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export function registerProgramRoutes(app: FastifyInstance, db: Db, clock: () => Date = () => new Date()) {
  // The programas the student has clases in from today on, then general clases if any.
  app.get('/student/programs', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const now = clock();
    const ctx = await contextOf(db, me.id, now);
    if (!ctx) return [];
    const started = await startedToday(db, ctx.mine.map((m) => m.course.id), bogotaInstant(ctx.today, '00:00'), now);
    return studentPrograms(db, ctx.loaded, ctx.mine, ctx.today, started);
  });

  // Clases of a programa the student could add (no programId: general clases), with what
  // each overlaps. With replacesCourseId, the clase being changed doesn't count as a clash.
  app.get<{ Querystring: { programId?: string; replacesCourseId?: string } }>(
    '/student/course-options',
    async (req, reply) => {
      const me = await requireStudent(db, req, reply);
      if (!me) return;
      const { programId, replacesCourseId } = req.query;
      if (programId !== undefined && !isUuid(programId)) return reply.code(400).send({ error: 'Programa inválido' });
      if (replacesCourseId !== undefined && !isUuid(replacesCourseId)) {
        return reply.code(400).send({ error: 'Clase inválida' });
      }
      const ctx = await contextOf(db, me.id, clock());
      if (!ctx) return [];
      const window = { today: ctx.today, endsOn: ctx.term.endsOn };
      return courseOptions(ctx.loaded, ctx.mine, ctx.pending, programId ?? null, window, replacesCourseId);
    },
  );

  // The student's requests this semestre, newest first.
  app.get('/student/enrollment-requests', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const ctx = await contextOf(db, me.id, clock());
    if (!ctx) return [];
    return requestsOf(db, ctx.loaded, ctx.mine, me.id, ctx.term.id);
  });

  /** Saves a request after `check` passes; the checks and the insert share one transaction. */
  function requestRoute<T extends z.ZodType<{ note?: string }>>(
    action: EnrollmentAction,
    input: T,
    check: (ctx: RequestContext, body: z.infer<T>) => RequestTarget,
  ) {
    app.post(`/student/enrollment-requests/${action}`, async (req, reply) => {
      const me = await requireStudent(db, req, reply);
      if (!me) return;
      const body = parse(input, req.body ?? {}, reply);
      if (!body) return;
      const now = clock();
      try {
        const saved = await db.transaction(async (tx) => {
          const ctx = await contextOf(tx, me.id, now);
          if (!ctx) throw new Problem(409, 'No hay un semestre configurado');
          const target = check(ctx, body);
          const [row] = await tx
            .insert(schema.enrollmentRequest)
            .values({ studentId: me.id, termId: ctx.term.id, action, ...target, note: body.note || null, createdAt: now })
            .returning();
          const requests = await requestsOf(tx, ctx.loaded, ctx.mine, me.id, ctx.term.id);
          return requests.find((r) => r.id === row!.id) as StudentEnrollmentRequest;
        });
        return reply.code(201).send(saved);
      } catch (err) {
        return sendProblem(reply, err);
      }
    });
  }

  requestRoute('join', joinRequestInput, (ctx, body) => checkJoin(ctx, body.courseId));
  requestRoute('swap', swapRequestInput, (ctx, body) => checkSwap(ctx, body.replacesCourseId, body.courseId));

  // Cancelling a clase applies right away: from `leaveOn` the student is off its list. When
  // the clase came with a línea, they keep the línea's other clases one by one.
  app.post<{ Params: { id: string } }>('/student/courses/:id/leave', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const courseId = req.params.id;
    if (!isUuid(courseId)) return reply.code(404).send({ error: 'No estás inscrito en esa clase' });
    const body = parse(leaveCourseInput, req.body ?? {}, reply);
    if (!body) return;
    const now = clock();
    try {
      const result = await db.transaction(async (tx) => {
        const ctx = await contextOf(tx, me.id, now);
        const current = ctx?.mine.find((m) => m.course.id === courseId);
        if (!ctx || !current) throw new Problem(404, 'No estás inscrito en esa clase');
        const { enrollment } = current;
        const started = await startedToday(tx, [courseId], bogotaInstant(ctx.today, '00:00'), now);
        const problem = leaveOnProblem(body.leaveOn, {
          today: ctx.today,
          startedToday: started.has(courseId),
          enrolledUntil: enrollment.validTo,
        });
        if (problem) throw new Problem(409, problem);
        if (enrollment.closedByChange) {
          throw new Problem(409, 'Esta clase ya tiene un cambio programado. Habla con dirección.');
        }

        // Clases of the línea the student doesn't also have through another inscripción.
        const elsewhere = new Set(ctx.mine.filter((m) => m.enrollment.id !== enrollment.id).map((m) => m.course.id));
        const others = enrollment.trackId
          ? ctx.loaded.coursesOfTrack(enrollment.trackId).filter((id) => id !== courseId && !elsewhere.has(id))
          : [];
        const plan = planLeave(enrollment, body.leaveOn, others);
        if (plan.closeValidTo === null) throw new Problem(409, 'Tu inscripción en esa clase ya termina antes de esa fecha');

        const [change] = await tx
          .insert(schema.enrollmentChange)
          .values({ studentId: me.id, effectiveOn: body.leaveOn, reason: 'Cancelación de clase', madeBy: me.id, madeAt: now })
          .returning();
        await tx
          .update(schema.enrollment)
          .set({ validTo: plan.closeValidTo, closedByChange: change!.id })
          .where(eq(schema.enrollment.id, enrollment.id));
        if (plan.keep.length > 0) {
          await tx.insert(schema.enrollment).values(
            plan.keep.map((k) => ({ studentId: me.id, termId: ctx.term.id, ...k, openedByChange: change!.id })),
          );
        }

        // A pending request to change this clase no longer makes sense.
        const withdraw = ctx.pending.filter((r) => r.replacesCourseId === courseId).map((r) => r.id);
        if (withdraw.length > 0) {
          await tx
            .update(schema.enrollmentRequest)
            .set({ status: 'withdrawn' })
            .where(and(inArray(schema.enrollmentRequest.id, withdraw), eq(schema.enrollmentRequest.status, 'pending')));
        }
        const left: CourseLeaveResult = { courseId, leaveOn: body.leaveOn, withdrawnRequests: withdraw.length };
        return left;
      });
      return result;
    } catch (err) {
      return sendProblem(reply, err);
    }
  });
}
