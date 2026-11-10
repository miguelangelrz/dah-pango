import { absenceNoticeInput, isoDate, type StudentHome } from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import { addDays, bogotaDate, bogotaInstant, can, noticeProblem } from '@dah-pango/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Problem } from '../admin/calendar';
import { balancesOf, loadSession, rostersOf, writeMark } from '../attendance/service';
import { parse, requireMember } from '../auth/routes';
import { byDay, currentTerm, enrolledProgramIds, programsById, studentSessions, studentSessionView } from './service';

// Students: Mis clases (the next days with clases, history, makeup balance) and absence notices.

const isUuid = (id: string) => z.uuid().safeParse(id).success;
/** How many days with clases Mis clases shows at a time. */
const DAYS_SHOWN = 3;
/** How far to look for the next or previous days with clases. */
const LOOK_DAYS = 120;

async function requireStudent(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const me = await requireMember(db, req, reply);
  if (!me) return null;
  if (!can(me.roles, 'send_requests')) {
    reply.code(403).send({ error: 'Esta sección es para estudiantes' });
    return null;
  }
  return me;
}

export function registerStudentRoutes(app: FastifyInstance, db: Db, clock: () => Date = () => new Date()) {
  // Mis clases: the first three days with clases from `desde` (today by default), where the
  // previous and next three start, this semestre's history and the makeup balance.
  app.get<{ Querystring: { desde?: string } }>('/student/home', async (req, reply) => {
    const me = await requireStudent(db, req, reply);
    if (!me) return;
    const now = clock();
    const today = bogotaDate(now);
    const from = isoDate.safeParse(req.query.desde).success ? req.query.desde! : today;
    const start = bogotaInstant(from, '00:00');
    const term = await currentTerm(db, today);

    const [ahead, behind, past] = await Promise.all([
      studentSessions(db, me.id, start, bogotaInstant(addDays(from, LOOK_DAYS), '00:00'), now),
      studentSessions(db, me.id, bogotaInstant(addDays(from, -LOOK_DAYS), '00:00'), start, now),
      term
        ? studentSessions(db, me.id, bogotaInstant(term.startsOn, '00:00'), now, now)
        : Promise.resolve([]),
    ]);
    const next = byDay(ahead);
    const prev = byDay(behind).slice(-DAYS_SHOWN);

    const [programs, balances, enrolled] = await Promise.all([
      programsById(db),
      balancesOf(db, [me.id]).then((b) => b.get(me.id) ?? new Map<string, number>()),
      term ? enrolledProgramIds(db, me.id, term.id, today) : Promise.resolve([]),
    ]);
    const programIds = [...new Set([...enrolled, ...balances.keys()])];

    const out: StudentHome = {
      term: term ? { id: term.id, name: term.name, startsOn: term.startsOn, endsOn: term.endsOn } : null,
      balances: programIds
        .map((id) => ({ program: programs.get(id)!, balance: balances.get(id) ?? 0 }))
        .filter((b) => b.program)
        .sort((a, b) => a.program.name.localeCompare(b.program.name, 'es')),
      from,
      days: next.slice(0, DAYS_SHOWN),
      prevFrom: prev[0]?.date ?? null,
      nextFrom: next[DAYS_SHOWN]?.date ?? null,
      history: past.filter((s) => new Date(s.endsAt) <= now).reverse(),
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
    try {
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
        await writeMark(tx, { loaded, personId: me.id, origin: 'enrolled', from: null, to: 'excused', source: 'notice', madeBy: me.id, now });
      });
    } catch (err) {
      if (err instanceof Problem) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
    return studentSessionView(loaded, { origin: 'enrolled', state: 'excused' }, true, now);
  });
}
