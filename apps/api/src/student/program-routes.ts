import {
  joinRequestInput,
  leaveRequestInput,
  swapRequestInput,
  type ProgramLeaveResult,
  type StudentEnrollmentRequest,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  addDays,
  bogotaDate,
  bogotaInstant,
  closingValidTo,
  programLeaveLastDay,
  type EnrollmentAction,
} from '@dah-pango/domain';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Problem } from '../admin/calendar';
import { parse } from '../auth/routes';
import {
  checkJoin,
  checkLeave,
  checkSwap,
  courseOptions,
  enrolledCourses,
  loadCourses,
  pendingRequests,
  requestProgramId,
  requestsOf,
  startedToday,
  studentPrograms,
  type RequestContext,
  type RequestTarget,
} from './programs';
import { requireStudent } from './routes';
import { currentTerm } from './service';

// Mis programas: a student's clases per programa, the clases they could add, their requests
// to add, change or cancel a clase (a director approves them), and leaving a whole programa
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
  // Every programa, then general clases, with the clases the student is in from today on.
  app.get('/student/programs', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const ctx = await contextOf(db, me.id, clock());
    if (!ctx) return [];
    return studentPrograms(db, ctx.loaded, ctx.mine);
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
  requestRoute('leave', leaveRequestInput, (ctx, body) => checkLeave(ctx, body.courseId));

  // Leaving a whole programa applies right away: every inscripción in it closes (keeping
  // today when one of its clases already started), and pending requests in it are withdrawn.
  app.post<{ Params: { id: string } }>('/student/programs/:id/leave', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const programId = req.params.id;
    if (!isUuid(programId)) return reply.code(404).send({ error: 'No encontramos ese programa' });
    const now = clock();
    try {
      const result = await db.transaction(async (tx) => {
        const ctx = await contextOf(tx, me.id, now);
        const inProgram = ctx?.mine.filter((m) => m.programId === programId) ?? [];
        if (!ctx || inProgram.length === 0) throw new Problem(409, 'No tienes clases en este programa');

        const started = await startedToday(
          tx,
          inProgram.map((m) => m.course.id),
          bogotaInstant(ctx.today, '00:00'),
          now,
        );
        const lastDay = programLeaveLastDay(ctx.today, started);
        const enrollments = [...new Map(inProgram.map((m) => [m.enrollment.id, m.enrollment])).values()].filter(
          (e) => e.closedByChange === null,
        );
        const closing = enrollments
          .map((e) => ({ id: e.id, validTo: closingValidTo(e, lastDay) }))
          .filter((c): c is { id: string; validTo: string } => c.validTo !== null);

        let closedEnrollments = 0;
        if (closing.length > 0) {
          const [change] = await tx
            .insert(schema.enrollmentChange)
            .values({ studentId: me.id, effectiveOn: addDays(lastDay, 1), reason: 'Salida del programa', madeBy: me.id, madeAt: now })
            .returning();
          for (const c of closing) {
            await tx
              .update(schema.enrollment)
              .set({ validTo: c.validTo, closedByChange: change!.id })
              .where(eq(schema.enrollment.id, c.id));
          }
          closedEnrollments = closing.length;
        }

        const withdraw = ctx.pending.filter((r) => requestProgramId(ctx.loaded, ctx.mine, r) === programId).map((r) => r.id);
        if (withdraw.length > 0) {
          await tx
            .update(schema.enrollmentRequest)
            .set({ status: 'withdrawn' })
            .where(and(inArray(schema.enrollmentRequest.id, withdraw), eq(schema.enrollmentRequest.status, 'pending')));
        }
        const summary: ProgramLeaveResult = { closedEnrollments, withdrawnRequests: withdraw.length };
        return summary;
      });
      return result;
    } catch (err) {
      return sendProblem(reply, err);
    }
  });
}
