import {
  absenceNoticeInput,
  enrollmentRequest,
  makeupRequest,
  reviewRequest,
  type RequestOptions,
  type StudentBalance,
  type StudentHome,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  addDays,
  bogotaDate,
  bogotaInstant,
  can,
  noticeProblem,
  reviewProblem,
  withdrawProblem,
  type Permission,
  type RequestStatus,
} from '@dah-pango/domain';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Problem } from '../admin/calendar';
import {
  balancesOf,
  loadSession,
  loadSessions,
  programForSession,
  rostersOf,
  writeMark,
} from '../attendance/service';
import { parse, requireMember } from '../auth/routes';
import { applyEnrollmentChange, checkMakeup, planEnrollmentChange } from './requests';
import {
  catalog,
  currentTerm,
  enrollmentsOf,
  enrollmentView,
  programIdsOf,
  requestViews,
  studentSessions,
  studentSessionView,
  termView,
} from './service';

// Students: their clases, absence notices, balances and requests.
// Directors and super admins: reviewing those requests.

const isUuid = (id: string) => z.uuid().safeParse(id).success;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAKEUP_WINDOW_DAYS = 21;

async function requirePermission(db: Db, req: FastifyRequest, reply: FastifyReply, permission: Permission, error: string) {
  const me = await requireMember(db, req, reply);
  if (!me) return null;
  if (!can(me.roles, permission)) {
    reply.code(403).send({ error });
    return null;
  }
  return me;
}

const requireStudent = (db: Db, req: FastifyRequest, reply: FastifyReply) =>
  requirePermission(db, req, reply, 'send_requests', 'Esta sección es para estudiantes');
const requireReviewer = (db: Db, req: FastifyRequest, reply: FastifyReply) =>
  requirePermission(db, req, reply, 'review_requests', 'Solo dirección revisa solicitudes');

async function guarded<T>(reply: FastifyReply, work: () => Promise<T>) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Problem) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

export function registerStudentRoutes(app: FastifyInstance, db: Db, clock: () => Date = () => new Date()) {
  // Mis clases: inscripciones, the next two weeks, this semestre's history and balances.
  app.get('/student/home', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const now = clock();
    const today = bogotaDate(now);
    const term = await currentTerm(db, today);
    const cat = await catalog(db);
    const enrollments = term ? await enrollmentsOf(db, me.id, term.id, today) : [];

    const historyFrom = term ? bogotaInstant(term.startsOn, '00:00') : new Date(now.getTime() - 120 * DAY_MS);
    const sessions = await studentSessions(db, me.id, historyFrom, bogotaInstant(addDays(today, 15), '00:00'), now);
    const upcoming = sessions.filter((s) => new Date(s.endsAt) > now);
    const history = sessions.filter((s) => new Date(s.endsAt) <= now).reverse();

    const balances = (await balancesOf(db, [me.id])).get(me.id) ?? new Map<string, number>();
    const programIds = new Set([...programIdsOf(cat, enrollments), ...balances.keys()]);
    const balanceList: StudentBalance[] = [...programIds]
      .map((id) => ({ program: cat.programs.get(id)!, balance: balances.get(id) ?? 0 }))
      .filter((b) => b.program)
      .sort((a, b) => a.program.name.localeCompare(b.program.name, 'es'));

    const pending = await requestViews(db, { studentId: me.id, status: 'pending' }, today);
    const out: StudentHome = {
      term: term ? termView(term) : null,
      enrollments: enrollments.map((e) => enrollmentView(cat, e)),
      balances: balanceList,
      upcoming,
      history,
      pendingRequests: pending.length,
    };
    return out;
  });

  // "No voy": until 24 hours before, the student marks their own Falta con aviso and earns a credit.
  app.post<{ Params: { id: string } }>('/student/sessions/:id/notice', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const body = parse(absenceNoticeInput, req.body ?? {}, reply);
    if (!body) return;
    const loaded = isUuid(req.params.id) ? await loadSession(db, req.params.id) : null;
    if (!loaded) return reply.code(404).send({ error: 'No encontramos esa sesión' });
    const now = clock();
    return guarded(reply, async () => {
      await db.transaction(async (tx) => {
        const roster = (await rostersOf(tx, [loaded.session])).get(loaded.session.id) ?? [];
        const row = roster.find((r) => r.personId === me.id) ?? null;
        const status = loaded.session.status as 'scheduled' | 'cancelled' | 'rescheduled';
        const problem = noticeProblem({ startsAt: loaded.session.startsAt, endsAt: loaded.session.endsAt, status }, row, now);
        if (problem) throw new Problem(409, problem);
        await tx.insert(schema.absenceNotice).values({
          sessionId: loaded.session.id,
          personId: me.id,
          sentBy: me.id,
          sentAt: now,
          note: body.note || null,
        });
        await writeMark(tx, {
          loaded,
          personId: me.id,
          origin: 'enrolled',
          from: null,
          to: 'excused',
          source: 'notice',
          madeBy: me.id,
          now,
        });
      });
      return studentSessionView(loaded, { origin: 'enrolled', state: 'excused' }, true, now);
    });
  });

  // What the request form offers: líneas, clases, the student's inscripciones and sesiones
  // open for a reposición in the next three weeks.
  app.get('/student/options', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const now = clock();
    const today = bogotaDate(now);
    const term = await currentTerm(db, today);
    const cat = await catalog(db);
    const enrollments = term ? await enrollmentsOf(db, me.id, term.id, today) : [];
    const open = enrollments.filter((e) => e.closedByChange === null);
    const programIds = programIdsOf(cat, enrollments);

    let makeupSessions: RequestOptions['makeupSessions'] = [];
    if (term) {
      const candidates = (
        await loadSessions(
          db,
          and(
            eq(schema.session.termId, term.id),
            eq(schema.session.status, 'scheduled'),
            gt(schema.session.startsAt, now),
            lt(schema.session.startsAt, new Date(now.getTime() + MAKEUP_WINDOW_DAYS * DAY_MS)),
          ),
        )
      ).filter((l) => l.course.kind === 'weekly' && (l.course.programId === null || programIds.includes(l.course.programId)));
      const [rosters, pending, balances] = await Promise.all([
        rostersOf(db, candidates.map((l) => l.session)),
        db
          .select({ sessionId: schema.makeupRequest.sessionId })
          .from(schema.makeupRequest)
          .where(and(eq(schema.makeupRequest.studentId, me.id), eq(schema.makeupRequest.status, 'pending'))),
        balancesOf(db, [me.id]).then((b) => b.get(me.id) ?? new Map<string, number>()),
      ]);
      const general = candidates.find((l) => l.course.programId === null);
      const generalProgram = general ? await programForSession(db, general, me.id) : null;
      makeupSessions = candidates
        .filter((l) => !(rosters.get(l.session.id) ?? []).some((r) => r.personId === me.id))
        .filter((l) => !pending.some((p) => p.sessionId === l.session.id))
        .filter((l) => l.course.programId !== null || generalProgram !== null)
        .map((l) => ({
          ...studentSessionView(l, { origin: 'makeup', state: null }, false, now),
          balance: balances.get(l.course.programId ?? generalProgram!) ?? 0,
        }));
    }

    const out: RequestOptions = {
      term: term ? termView(term) : null,
      today,
      tracks: cat.tracks.filter((t) => t.active).map((t) => cat.trackOptions.get(t.id)!),
      courses: cat.courses.filter((c) => c.kind === 'weekly').map((c) => cat.courseOptions.get(c.id)!),
      enrollments: open.map((e) => enrollmentView(cat, e)),
      makeupSessions,
    };
    return out;
  });

  app.get('/student/requests', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    return requestViews(db, { studentId: me.id }, bogotaDate(clock()));
  });

  app.post('/student/requests/enrollment', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const body = parse(enrollmentRequest, req.body, reply);
    if (!body) return;
    const now = clock();
    const today = bogotaDate(now);
    return guarded(reply, async () => {
      const term = await currentTerm(db, today);
      if (!term) throw new Problem(409, 'No hay semestre configurado');
      const start = body.wantedStart ?? (term.startsOn > today ? term.startsOn : today);
      await planEnrollmentChange(db, await catalog(db), term, me.id, body, start, today);
      const [same] = await db
        .select({ id: schema.enrollmentRequest.id })
        .from(schema.enrollmentRequest)
        .where(
          and(
            eq(schema.enrollmentRequest.studentId, me.id),
            eq(schema.enrollmentRequest.status, 'pending'),
            eq(schema.enrollmentRequest.action, body.action),
            body.trackId ? eq(schema.enrollmentRequest.trackId, body.trackId) : isNull(schema.enrollmentRequest.trackId),
            body.courseId ? eq(schema.enrollmentRequest.courseId, body.courseId) : isNull(schema.enrollmentRequest.courseId),
            body.replacesEnrollmentId
              ? eq(schema.enrollmentRequest.replacesEnrollmentId, body.replacesEnrollmentId)
              : isNull(schema.enrollmentRequest.replacesEnrollmentId),
          ),
        );
      if (same) throw new Problem(409, 'Ya tienes una solicitud igual esperando respuesta');
      const [row] = await db
        .insert(schema.enrollmentRequest)
        .values({
          studentId: me.id,
          termId: term.id,
          action: body.action,
          trackId: body.action === 'leave' ? null : (body.trackId ?? null),
          courseId: body.action === 'leave' ? null : (body.courseId ?? null),
          replacesEnrollmentId: body.action === 'join' ? null : body.replacesEnrollmentId!,
          wantedStart: start,
          note: body.note || null,
          createdAt: now,
        })
        .returning({ id: schema.enrollmentRequest.id });
      const [view] = (await requestViews(db, { studentId: me.id }, today)).filter((r) => r.id === row!.id);
      return reply.code(201).send(view);
    });
  });

  app.post('/student/requests/makeup', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const body = parse(makeupRequest, req.body, reply);
    if (!body) return;
    const now = clock();
    return guarded(reply, async () => {
      const loaded = await loadSession(db, body.sessionId);
      if (!loaded) throw new Problem(404, 'No encontramos esa sesión');
      const programId = await checkMakeup(db, await catalog(db), loaded, me.id, now);
      const [same] = await db
        .select({ id: schema.makeupRequest.id })
        .from(schema.makeupRequest)
        .where(
          and(
            eq(schema.makeupRequest.studentId, me.id),
            eq(schema.makeupRequest.sessionId, loaded.session.id),
            eq(schema.makeupRequest.status, 'pending'),
          ),
        );
      if (same) throw new Problem(409, 'Ya pediste reposición en esa sesión');
      const [row] = await db
        .insert(schema.makeupRequest)
        .values({ studentId: me.id, sessionId: loaded.session.id, programId, note: body.note || null, createdAt: now })
        .returning({ id: schema.makeupRequest.id });
      const [view] = (await requestViews(db, { studentId: me.id }, bogotaDate(now))).filter((r) => r.id === row!.id);
      return reply.code(201).send(view);
    });
  });

  // The student takes back a request: pending ones, or an approved reposición before the clase.
  app.post<{ Params: { kind: string; id: string } }>('/student/requests/:kind/:id/withdraw', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const now = clock();
    const { kind, id } = req.params;
    if (!isUuid(id) || (kind !== 'enrollment' && kind !== 'makeup')) {
      return reply.code(404).send({ error: 'No encontramos esa solicitud' });
    }
    return guarded(reply, async () => {
      if (kind === 'enrollment') {
        const [r] = await db
          .select()
          .from(schema.enrollmentRequest)
          .where(and(eq(schema.enrollmentRequest.id, id), eq(schema.enrollmentRequest.studentId, me.id)));
        if (!r) throw new Problem(404, 'No encontramos esa solicitud');
        const problem = withdrawProblem(r.status as RequestStatus);
        if (problem) throw new Problem(409, problem);
        await db.update(schema.enrollmentRequest).set({ status: 'withdrawn' }).where(eq(schema.enrollmentRequest.id, id));
      } else {
        const [r] = await db
          .select()
          .from(schema.makeupRequest)
          .where(and(eq(schema.makeupRequest.id, id), eq(schema.makeupRequest.studentId, me.id)));
        if (!r) throw new Problem(404, 'No encontramos esa solicitud');
        const loaded = (await loadSession(db, r.sessionId))!;
        const [mark] = await db
          .select()
          .from(schema.attendance)
          .where(and(eq(schema.attendance.sessionId, r.sessionId), eq(schema.attendance.personId, me.id)));
        const problem = withdrawProblem(r.status as RequestStatus, {
          startsAt: loaded.session.startsAt,
          marked: Boolean(mark),
          now,
        });
        if (problem) throw new Problem(409, problem);
        await db.update(schema.makeupRequest).set({ status: 'withdrawn' }).where(eq(schema.makeupRequest.id, id));
      }
      return requestViews(db, { studentId: me.id }, bogotaDate(now));
    });
  });

  // Directors and super admins: pending requests first; `?estado=todas` adds the reviewed ones.
  app.get<{ Querystring: { estado?: string } }>('/requests', async (req, reply) => {
    const me = await requireReviewer(db, req, reply);
    if (!me) return;
    const today = bogotaDate(clock());
    return requestViews(db, req.query.estado === 'todas' ? {} : { status: 'pending' }, today);
  });

  // Approve (optionally from another start date) or deny an inscripción, cambio or salida.
  app.post<{ Params: { id: string } }>('/requests/enrollment/:id/review', async (req, reply) => {
    const me = await requireReviewer(db, req, reply);
    if (!me) return;
    const body = parse(reviewRequest, req.body, reply);
    if (!body) return;
    if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'No encontramos esa solicitud' });
    const now = clock();
    const today = bogotaDate(now);
    return guarded(reply, async () => {
      await db.transaction(async (tx) => {
        const [r] = await tx
          .select()
          .from(schema.enrollmentRequest)
          .where(eq(schema.enrollmentRequest.id, req.params.id))
          .for('update');
        if (!r) throw new Problem(404, 'No encontramos esa solicitud');
        const problem = reviewProblem(r.status as RequestStatus);
        if (problem) throw new Problem(409, problem);
        const reviewed = { reviewedBy: me.id, reviewedAt: now, reply: body.reply || null };
        if (body.decision === 'deny') {
          await tx.update(schema.enrollmentRequest).set({ status: 'denied', ...reviewed }).where(eq(schema.enrollmentRequest.id, r.id));
          return;
        }
        const [term] = await tx.select().from(schema.term).where(eq(schema.term.id, r.termId));
        const start = body.approvedStart ?? (r.wantedStart && r.wantedStart >= today ? r.wantedStart : today);
        const action = r.action as 'join' | 'leave' | 'swap';
        const plan = await planEnrollmentChange(
          tx,
          await catalog(tx),
          term!,
          r.studentId,
          {
            action,
            trackId: r.trackId ?? undefined,
            courseId: r.courseId ?? undefined,
            replacesEnrollmentId: r.replacesEnrollmentId ?? undefined,
          },
          start,
          today,
        );
        await applyEnrollmentChange(tx, term!, r.studentId, plan, { madeBy: me.id, requestId: r.id, reason: action, now });
        await tx
          .update(schema.enrollmentRequest)
          .set({ status: 'approved', approvedStart: start, ...reviewed })
          .where(eq(schema.enrollmentRequest.id, r.id));
      });
      return requestViews(db, { status: 'pending' }, today);
    });
  });

  // Approve or deny a reposición: once approved, the student is on that sesión's list.
  app.post<{ Params: { id: string } }>('/requests/makeup/:id/review', async (req, reply) => {
    const me = await requireReviewer(db, req, reply);
    if (!me) return;
    const body = parse(reviewRequest, req.body, reply);
    if (!body) return;
    if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'No encontramos esa solicitud' });
    const now = clock();
    const today = bogotaDate(now);
    return guarded(reply, async () => {
      await db.transaction(async (tx) => {
        const [r] = await tx.select().from(schema.makeupRequest).where(eq(schema.makeupRequest.id, req.params.id)).for('update');
        if (!r) throw new Problem(404, 'No encontramos esa solicitud');
        const problem = reviewProblem(r.status as RequestStatus);
        if (problem) throw new Problem(409, problem);
        const reviewed = { reviewedBy: me.id, reviewedAt: now, reply: body.reply || null };
        if (body.decision === 'approve') {
          const loaded = (await loadSession(tx, r.sessionId))!;
          await checkMakeup(tx, await catalog(tx), loaded, r.studentId, now);
        }
        await tx
          .update(schema.makeupRequest)
          .set({ status: body.decision === 'approve' ? 'approved' : 'denied', ...reviewed })
          .where(eq(schema.makeupRequest.id, r.id));
      });
      return requestViews(db, { status: 'pending' }, today);
    });
  });
}
