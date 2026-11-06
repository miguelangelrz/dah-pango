import {
  blocksInput,
  courseSlotsInput,
  termInput,
  type AdminCourse,
  type AdminTerm,
  type SessionSyncSummary,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  blocksProblem,
  bogotaDate,
  can,
  generateBlocks,
  parseIsoDate,
  shortTime,
  slotDurationMinutes,
  slotFromDuration,
  slotsProblem,
  termProblem,
  type WeeklySlot,
} from '@dah-pango/domain';
import { asc, count, desc, eq, gte, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parse, requireMember } from '../auth/routes';
import { Problem, addSummaries, emptySummary, replaceBlocks, slotsOf, syncCourseSessions, syncTermSessions } from './calendar';

// Configuration screens for directors and super admins: semestres, bloques and the weekly
// schedule of each clase. Every change brings the upcoming sesiones in line.

const isUuid = (id: string) => z.uuid().safeParse(id).success;

async function requireConfigurator(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const me = await requireMember(db, req, reply);
  if (!me) return null;
  if (!can(me.roles, 'configure_academy')) {
    reply.code(403).send({ error: 'Solo la dirección puede cambiar la configuración' });
    return null;
  }
  return me;
}

async function guarded<T>(reply: FastifyReply, work: () => Promise<T>) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Problem) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

async function loadTerm(db: Db, id: string): Promise<AdminTerm | null> {
  const [term] = await db.select().from(schema.term).where(eq(schema.term.id, id));
  if (!term) return null;
  const [blocks, [sessions], [enrollments]] = await Promise.all([
    db
      .select({
        id: schema.block.id,
        number: schema.block.number,
        startsOn: schema.block.startsOn,
        endsOn: schema.block.endsOn,
      })
      .from(schema.block)
      .where(eq(schema.block.termId, id))
      .orderBy(asc(schema.block.number)),
    db.select({ n: count() }).from(schema.session).where(eq(schema.session.termId, id)),
    db.select({ n: count() }).from(schema.enrollment).where(eq(schema.enrollment.termId, id)),
  ]);
  return {
    ...term,
    blocks,
    sessionCount: sessions?.n ?? 0,
    enrollmentCount: enrollments?.n ?? 0,
  };
}

function toAdminSlots(slots: WeeklySlot[]) {
  return slots.map((s) => ({
    weekday: s.weekday,
    startsAt: shortTime(s.startsAt),
    endsAt: shortTime(s.endsAt),
    durationMinutes: slotDurationMinutes(s),
  }));
}

async function loadCourses(db: Db, courseId?: string): Promise<AdminCourse[]> {
  const rows = await db
    .select({ course: schema.course, program: schema.program })
    .from(schema.course)
    .leftJoin(schema.program, eq(schema.program.id, schema.course.programId))
    .where(courseId ? eq(schema.course.id, courseId) : undefined)
    .orderBy(asc(schema.program.name), asc(schema.course.title));
  const slots = await db
    .select()
    .from(schema.courseSlot)
    .orderBy(asc(schema.courseSlot.weekday), asc(schema.courseSlot.startsAt));
  return rows.map(({ course, program }) => ({
    id: course.id,
    title: course.title,
    kind: course.kind as AdminCourse['kind'],
    modality: course.modality as AdminCourse['modality'],
    program: program ? { id: program.id, name: program.name, accentColor: program.accentColor } : null,
    startsOn: course.startsOn,
    endsOn: course.endsOn,
    slots: toAdminSlots(slots.filter((s) => s.courseId === course.id)),
  }));
}

export function registerAdminRoutes(app: FastifyInstance, db: Db, clock: () => Date = () => new Date()) {
  app.get('/admin/terms', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const terms = await db.select({ id: schema.term.id }).from(schema.term).orderBy(desc(schema.term.startsOn));
    return Promise.all(terms.map((t) => loadTerm(db, t.id)));
  });

  app.get<{ Params: { id: string } }>('/admin/terms/:id', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const term = isUuid(req.params.id) ? await loadTerm(db, req.params.id) : null;
    return term ?? reply.code(404).send({ error: 'No encontramos ese semestre' });
  });

  // A new semestre gets its 4-week bloques and the sesiones of every weekly clase.
  app.post('/admin/terms', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const body = parse(termInput, req.body, reply);
    if (!body) return;
    return guarded(reply, async () => {
      const result = await db.transaction(async (tx) => {
        const others = await tx.select().from(schema.term);
        const problem = termProblem(body, others);
        if (problem) throw new Problem(400, problem);
        const [term] = await tx.insert(schema.term).values(body).returning();
        if (!term) throw new Error('Term insert failed');
        await replaceBlocks(tx, term.id, generateBlocks(term.startsOn, term.endsOn));
        const sessions = await syncTermSessions(tx, term, clock());
        return { id: term.id, sessions };
      });
      return reply.code(201).send({ term: await loadTerm(db, result.id), sessions: result.sessions });
    });
  });

  // New dates recalculate the bloques from the start and move the upcoming sesiones.
  app.put<{ Params: { id: string } }>('/admin/terms/:id', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const body = parse(termInput, req.body, reply);
    if (!body) return;
    const current = isUuid(req.params.id) ? await loadTerm(db, req.params.id) : null;
    if (!current) return reply.code(404).send({ error: 'No encontramos ese semestre' });

    return guarded(reply, async () => {
      const today = bogotaDate(clock());
      const startMoved = body.startsOn !== current.startsOn;
      const endMoved = body.endsOn !== current.endsOn;
      if ((startMoved || endMoved) && current.enrollmentCount > 0) {
        throw new Problem(409, 'Este semestre ya tiene inscripciones, así que sus fechas no se pueden cambiar');
      }
      if (startMoved && parseIsoDate(current.startsOn) <= parseIsoDate(today)) {
        throw new Problem(400, 'El semestre ya empezó: su fecha de inicio no se puede cambiar');
      }
      if (endMoved && parseIsoDate(body.endsOn) < parseIsoDate(today)) {
        throw new Problem(400, 'La nueva fecha de fin ya pasó');
      }

      let sessions: SessionSyncSummary = emptySummary();
      await db.transaction(async (tx) => {
        const others = await tx.select().from(schema.term).where(ne(schema.term.id, current.id));
        const problem = termProblem(body, others);
        if (problem) throw new Problem(400, problem);
        const [term] = await tx.update(schema.term).set(body).where(eq(schema.term.id, current.id)).returning();
        if (!term) throw new Error('Term update failed');
        if (startMoved || endMoved) {
          await replaceBlocks(tx, term.id, generateBlocks(term.startsOn, term.endsOn));
          sessions = await syncTermSessions(tx, term, clock());
        }
      });
      return { term: await loadTerm(db, current.id), sessions };
    });
  });

  // Bloques can be moved by hand, for example to leave a holiday week out.
  app.put<{ Params: { id: string } }>('/admin/terms/:id/blocks', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const body = parse(blocksInput, req.body, reply);
    if (!body) return;
    const current = isUuid(req.params.id) ? await loadTerm(db, req.params.id) : null;
    if (!current) return reply.code(404).send({ error: 'No encontramos ese semestre' });
    const blocks = body.blocks.map((b, i) => ({ number: i + 1, ...b }));
    const problem = blocksProblem(current, blocks);
    if (problem) return reply.code(400).send({ error: problem });
    await db.transaction((tx) => replaceBlocks(tx, current.id, blocks));
    return { term: await loadTerm(db, current.id) };
  });

  app.get('/admin/courses', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    return loadCourses(db);
  });

  app.get<{ Params: { id: string } }>('/admin/courses/:id', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const [course] = isUuid(req.params.id) ? await loadCourses(db, req.params.id) : [];
    return course ?? reply.code(404).send({ error: 'No encontramos esa clase' });
  });

  // A clase's weekly schedule; its upcoming sesiones in current and future semestres follow.
  app.put<{ Params: { id: string } }>('/admin/courses/:id/slots', async (req, reply) => {
    if (!(await requireConfigurator(db, req, reply))) return;
    const body = parse(courseSlotsInput, req.body, reply);
    if (!body) return;
    const [course] = isUuid(req.params.id)
      ? await db.select().from(schema.course).where(eq(schema.course.id, req.params.id))
      : [];
    if (!course) return reply.code(404).send({ error: 'No encontramos esa clase' });
    if (course.kind !== 'weekly') {
      return reply.code(400).send({ error: 'Las clases especiales no tienen horario semanal' });
    }

    const slots: WeeklySlot[] = [];
    for (const s of body.slots) {
      const slot = slotFromDuration(s.weekday, s.startsAt, s.durationMinutes);
      if (!slot) return reply.code(400).send({ error: 'Una clase no puede terminar después de la medianoche' });
      slots.push(slot);
    }
    const problem = slotsProblem(slots);
    if (problem) return reply.code(400).send({ error: problem });

    return guarded(reply, async () => {
      const now = clock();
      const sessions = await db.transaction(async (tx) => {
        await tx.delete(schema.courseSlot).where(eq(schema.courseSlot.courseId, course.id));
        if (slots.length > 0) {
          await tx.insert(schema.courseSlot).values(slots.map((s) => ({ courseId: course.id, ...s })));
        }
        const terms = await tx.select().from(schema.term).where(gte(schema.term.endsOn, bogotaDate(now)));
        let summary = emptySummary();
        for (const term of terms) {
          summary = addSummaries(summary, await syncCourseSessions(tx, term, course, slots, now));
        }
        return summary;
      });
      const [updated] = await loadCourses(db, course.id);
      return { course: updated, sessions };
    });
  });
}
