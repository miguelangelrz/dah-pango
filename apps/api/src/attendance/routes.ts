import {
  addMakeup,
  addWalkIn,
  attendanceMarks,
  handOffSession,
  isoDate,
  type AttendanceDay,
  type AttendanceSessionDetail,
  type PersonMatch,
  type TeacherOption,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  addDays,
  addPersonProblem,
  bogotaDate,
  bogotaInstant,
  can,
  canTakeAttendanceFor,
  isLocked,
  isSuperAdmin,
  markProblem,
  normalizeDocumentNumber,
  writeSource,
  type AttendanceOrigin,
  type AttendanceState,
} from '@dah-pango/domain';
import { and, asc, eq, gt, gte, ilike, inArray, isNull, lt, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Problem } from '../admin/calendar';
import { parse, requireMember } from '../auth/routes';
import {
  balancesOf,
  documentOf,
  loadSession,
  loadSessions,
  lockDueSessions,
  lockSession,
  programForSession,
  rostersOf,
  summarize,
  writeMark,
  type LoadedSession,
} from './service';

// Attendance for teachers, directors and super admins: the day's sesiones, each sesión's
// list, marking, makeups, walk-ins and handing a sesión to someone else.

const isUuid = (id: string) => z.uuid().safeParse(id).success;
const DAY_MS = 24 * 60 * 60 * 1000;

type Member = NonNullable<Awaited<ReturnType<typeof requireMember>>>;

async function requireTeacher(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const me = await requireMember(db, req, reply);
  if (!me) return null;
  if (!can(me.roles, 'take_attendance')) {
    reply.code(403).send({ error: 'Solo profes y dirección toman asistencia' });
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

/** The sesión, if this person may take its attendance; otherwise replies 404 or 403. */
async function sessionFor(db: Db, me: Member, id: string, reply: FastifyReply): Promise<LoadedSession | null> {
  const loaded = isUuid(id) ? await loadSession(db, id) : null;
  if (!loaded) {
    reply.code(404).send({ error: 'No encontramos esa sesión' });
    return null;
  }
  if (!canTakeAttendanceFor(me.roles, me.id, loaded.session.teacherId)) {
    reply.code(403).send({ error: 'Esta sesión la lleva otro profe' });
    return null;
  }
  return loaded;
}

const timing = (l: LoadedSession) => ({
  startsAt: l.session.startsAt,
  endsAt: l.session.endsAt,
  status: l.session.status as 'scheduled' | 'cancelled' | 'rescheduled',
});

export function registerAttendanceRoutes(app: FastifyInstance, db: Db, clock: () => Date = () => new Date()) {
  // The sesiones of one day (Bogotá), and earlier ones still waiting for marks.
  // Teachers see theirs; directors and super admins see the whole academy.
  app.get<{ Querystring: { fecha?: string } }>('/attendance/day', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const now = clock();
    await lockDueSessions(db, now);
    const date = isoDate.safeParse(req.query.fecha).success ? req.query.fecha! : bogotaDate(now);
    const everyone = isSuperAdmin(me.roles);
    const mineOnly = everyone ? undefined : eq(schema.session.teacherId, me.id);

    const [day, open] = await Promise.all([
      loadSessions(
        db,
        and(
          gte(schema.session.startsAt, bogotaInstant(date, '00:00')),
          lt(schema.session.startsAt, bogotaInstant(addDays(date, 1), '00:00')),
          mineOnly,
        ),
      ),
      loadSessions(
        db,
        and(
          lt(schema.session.endsAt, now),
          gt(schema.session.endsAt, new Date(now.getTime() - DAY_MS)),
          eq(schema.session.status, 'scheduled'),
          mineOnly,
        ),
      ),
    ]);
    const all = [...day, ...open.filter((o) => !day.some((d) => d.session.id === o.session.id))];
    const rosters = await rostersOf(db, all.map((l) => l.session));
    const summary = (l: LoadedSession) => summarize(l, rosters.get(l.session.id) ?? [], me.id, now);
    const result: AttendanceDay = {
      date,
      sessions: day.map(summary),
      pending: open
        .filter((o) => bogotaDate(o.session.startsAt) !== date)
        .map(summary)
        .filter((s) => s.counts.marked < s.counts.listed),
    };
    return result;
  });

  app.get<{ Params: { id: string } }>('/attendance/sessions/:id', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const now = clock();
    let loaded = await sessionFor(db, me, req.params.id, reply);
    if (!loaded) return;
    if (!loaded.session.lockedAt && isLocked(loaded.session.endsAt, now)) {
      await lockSession(db, loaded, now);
      loaded = (await loadSession(db, loaded.session.id))!;
    }
    return detail(loaded, me, now);
  });

  async function detail(loaded: LoadedSession, me: Member, now: Date): Promise<AttendanceSessionDetail> {
    const listed = (await rostersOf(db, [loaded.session])).get(loaded.session.id) ?? [];
    const ids = listed.map((r) => r.personId);
    const [people, notices, handoffs] = await Promise.all([
      ids.length
        ? db
            .select({ person: schema.person, accountId: schema.account.personId })
            .from(schema.person)
            .leftJoin(schema.account, eq(schema.account.personId, schema.person.id))
            .where(inArray(schema.person.id, ids))
        : [],
      db
        .select({ personId: schema.absenceNotice.personId })
        .from(schema.absenceNotice)
        .where(eq(schema.absenceNotice.sessionId, loaded.session.id)),
      db
        .select()
        .from(schema.sessionHandoff)
        .where(eq(schema.sessionHandoff.sessionId, loaded.session.id))
        .orderBy(asc(schema.sessionHandoff.madeAt)),
    ]);
    const balances = await balancesOf(db, ids);
    const handoffNames = handoffs.length
      ? await db
          .select({ id: schema.person.id, fullName: schema.person.fullName })
          .from(schema.person)
          .where(inArray(schema.person.id, handoffs.flatMap((h) => [h.fromTeacherId, h.toTeacherId])))
      : [];
    const nameOf = (id: string) => handoffNames.find((p) => p.id === id)?.fullName ?? '';
    const programId = loaded.course.programId;

    const originOrder: Record<AttendanceOrigin, number> = { enrolled: 0, makeup: 1, walk_in: 2 };
    const roster = listed
      .map((r) => {
        const p = people.find((x) => x.person.id === r.personId);
        return {
          personId: r.personId,
          fullName: p?.person.fullName ?? '',
          document: p ? documentOf(p.person) : null,
          origin: r.origin,
          state: r.state,
          noticeSent: notices.some((n) => n.personId === r.personId),
          balance: programId ? (balances.get(r.personId)?.get(programId) ?? 0) : null,
          hasAccount: Boolean(p?.accountId),
          approvedRequest: r.makeupRequestId !== null,
        };
      })
      .sort((a, b) => originOrder[a.origin] - originOrder[b.origin] || a.fullName.localeCompare(b.fullName, 'es'));

    const t = timing(loaded);
    const closed = markProblem(t, 'enrolled', 'excused', now);
    const early = markProblem(t, 'enrolled', 'present', now);
    return {
      ...summarize(loaded, listed, me.id, now),
      topic: loaded.session.topic,
      canEdit: closed === null,
      notice: closed ?? early,
      canMarkNow: early === null,
      roster,
      handoffs: handoffs.map((h) => ({ from: nameOf(h.fromTeacherId), to: nameOf(h.toTeacherId), madeAt: h.madeAt.toISOString() })),
    };
  }

  // Several marks at once, so "everyone left: Asistió" is one request.
  app.put<{ Params: { id: string } }>('/attendance/sessions/:id/marks', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const body = parse(attendanceMarks, req.body, reply);
    if (!body) return;
    const loaded = await sessionFor(db, me, req.params.id, reply);
    if (!loaded) return;
    const now = clock();
    return guarded(reply, async () => {
      await db.transaction(async (tx) => {
        const roster = (await rostersOf(tx, [loaded.session])).get(loaded.session.id) ?? [];
        for (const mark of body.marks) {
          const row = roster.find((r) => r.personId === mark.personId);
          if (!row) throw new Problem(400, 'Esa persona no está en la lista de esta sesión');
          const problem = markProblem(timing(loaded), row.origin, mark.state, now);
          if (problem) throw new Problem(409, problem);
          if (row.state === mark.state) continue;
          await writeMark(tx, {
            loaded,
            personId: row.personId,
            origin: row.origin,
            from: row.state,
            to: mark.state,
            source: writeSource(me.roles, me.id, loaded.session.teacherId),
            madeBy: me.id,
            makeupRequestId: row.makeupRequestId,
            now,
          });
          row.state = mark.state;
        }
      });
      return detail(loaded, me, now);
    });
  });

  // Search people to add as a makeup: by name or document number.
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/attendance/sessions/:id/people', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const loaded = await sessionFor(db, me, req.params.id, reply);
    if (!loaded) return;
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return [];
    const digits = q.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const rows = await db
      .select()
      .from(schema.person)
      .where(
        and(
          isNull(schema.person.mergedInto),
          or(
            ilike(schema.person.fullName, `%${q.replace(/[%_\\]/g, '')}%`),
            digits.length >= 3 ? ilike(schema.person.documentNumber, `${digits}%`) : undefined,
          ),
        ),
      )
      .orderBy(asc(schema.person.fullName))
      .limit(15);
    const roster = (await rostersOf(db, [loaded.session])).get(loaded.session.id) ?? [];
    const out: PersonMatch[] = rows.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      document: documentOf(p),
      listed: roster.some((r) => r.personId === p.id),
    }));
    return out;
  });

  async function addToList(
    loaded: LoadedSession,
    me: Member,
    personId: string,
    origin: AttendanceOrigin,
    state: AttendanceState,
  ) {
    const now = clock();
    const problem = addPersonProblem(timing(loaded), now);
    if (problem) throw new Problem(409, problem);
    await db.transaction(async (tx) => {
      const roster = (await rostersOf(tx, [loaded.session])).get(loaded.session.id) ?? [];
      if (roster.some((r) => r.personId === personId)) throw new Problem(409, 'Esa persona ya está en la lista');
      await writeMark(tx, {
        loaded,
        personId,
        origin,
        from: null,
        to: state,
        source: writeSource(me.roles, me.id, loaded.session.teacherId),
        madeBy: me.id,
        now,
      });
    });
    return detail(loaded, me, now);
  }

  // A student from another clase takes this one as a reposición (same programa or a general clase).
  app.post<{ Params: { id: string } }>('/attendance/sessions/:id/makeups', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const body = parse(addMakeup, req.body, reply);
    if (!body) return;
    const loaded = await sessionFor(db, me, req.params.id, reply);
    if (!loaded) return;
    return guarded(reply, async () => {
      const [person] = await db
        .select()
        .from(schema.person)
        .where(and(eq(schema.person.id, body.personId), isNull(schema.person.mergedInto)));
      if (!person) throw new Problem(404, 'No encontramos a esa persona');
      if (!(await programForSession(db, loaded, person.id))) {
        throw new Problem(409, 'No sabemos a qué programa cargar esta reposición. La dirección debe revisarlo.');
      }
      return reply.code(201).send(await addToList(loaded, me, person.id, 'makeup', 'makeup'));
    });
  });

  // Someone without an account shows up: they are marked Asistió. With a document, an
  // existing record is reused, and their history joins their account when they sign up.
  app.post<{ Params: { id: string } }>('/attendance/sessions/:id/walk-ins', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const body = parse(addWalkIn, req.body, reply);
    if (!body) return;
    const loaded = await sessionFor(db, me, req.params.id, reply);
    if (!loaded) return;
    return guarded(reply, async () => {
      const problem = addPersonProblem(timing(loaded), clock());
      if (problem) throw new Problem(409, problem);
      const documentType = body.documentNumber ? body.documentType : undefined;
      const documentNumber = documentType ? normalizeDocumentNumber(documentType, body.documentNumber!) : undefined;
      if (documentType && (documentNumber ?? '').length < 3) throw new Problem(400, 'Número de documento inválido');

      let personId: string | undefined;
      if (documentType && documentNumber) {
        const [found] = await db
          .select({ id: schema.person.id })
          .from(schema.person)
          .where(
            and(
              eq(schema.person.documentType, documentType),
              eq(schema.person.documentNumber, documentNumber),
              isNull(schema.person.mergedInto),
            ),
          );
        personId = found?.id;
      }
      if (!personId) {
        const [created] = await db
          .insert(schema.person)
          .values({ fullName: body.fullName, phone: body.phone, documentType, documentNumber })
          .returning({ id: schema.person.id });
        personId = created!.id;
      }
      return reply.code(201).send(await addToList(loaded, me, personId, 'walk_in', 'present'));
    });
  });

  // Takes a makeup or walk-in added by mistake off the list (the event log keeps it).
  app.delete<{ Params: { id: string; personId: string } }>(
    '/attendance/sessions/:id/people/:personId',
    async (req, reply) => {
      const me = await requireTeacher(db, req, reply);
      if (!me) return;
      const loaded = await sessionFor(db, me, req.params.id, reply);
      if (!loaded) return;
      const now = clock();
      return guarded(reply, async () => {
        const problem = addPersonProblem(timing(loaded), now);
        if (problem) throw new Problem(409, problem);
        await db.transaction(async (tx) => {
          const roster = (await rostersOf(tx, [loaded.session])).get(loaded.session.id) ?? [];
          const row = roster.find((r) => r.personId === req.params.personId);
          if (!row) throw new Problem(404, 'Esa persona no está en la lista');
          if (row.origin === 'enrolled') {
            throw new Problem(409, 'Solo se pueden quitar reposiciones y visitantes; a un inscrito se le marca Falta');
          }
          if (row.makeupRequestId) {
            throw new Problem(409, 'Esta reposición la aprobó dirección: si no vino, márcala como Falta');
          }
          await writeMark(tx, {
            loaded,
            personId: row.personId,
            origin: row.origin,
            from: row.state,
            to: null,
            source: writeSource(me.roles, me.id, loaded.session.teacherId),
            madeBy: me.id,
            now,
          });
        });
        return detail(loaded, me, now);
      });
    },
  );

  // People who can take a sesión: everyone with the teacher role.
  app.get('/attendance/teachers', async (req, reply) => {
    if (!(await requireTeacher(db, req, reply))) return;
    const rows = await db
      .selectDistinct({ id: schema.person.id, fullName: schema.person.fullName, accountId: schema.account.personId })
      .from(schema.roleGrant)
      .innerJoin(schema.person, eq(schema.person.id, schema.roleGrant.personId))
      .leftJoin(schema.account, eq(schema.account.personId, schema.person.id))
      .where(and(eq(schema.roleGrant.role, 'teacher'), isNull(schema.person.mergedInto)))
      .orderBy(asc(schema.person.fullName));
    const out: TeacherOption[] = rows.map((r) => ({ id: r.id, fullName: r.fullName, hasAccount: r.accountId !== null }));
    return out;
  });

  // Hand the sesión to a substitute, or to a guest teacher known only by name.
  app.put<{ Params: { id: string } }>('/attendance/sessions/:id/teacher', async (req, reply) => {
    const me = await requireTeacher(db, req, reply);
    if (!me) return;
    const body = parse(handOffSession, req.body, reply);
    if (!body) return;
    const loaded = await sessionFor(db, me, req.params.id, reply);
    if (!loaded) return;
    const now = clock();
    return guarded(reply, async () => {
      if (loaded.session.status !== 'scheduled') throw new Problem(409, 'Esta sesión no está programada');
      if (isLocked(loaded.session.endsAt, now)) throw new Problem(409, 'La asistencia de esta sesión ya se cerró');
      const toId = await db.transaction(async (tx) => {
        let teacherId: string;
        if ('teacherId' in body) {
          const [grant] = await tx
            .select()
            .from(schema.roleGrant)
            .where(and(eq(schema.roleGrant.personId, body.teacherId), eq(schema.roleGrant.role, 'teacher')));
          if (!grant) throw new Problem(404, 'Esa persona no es profe de la academia');
          teacherId = body.teacherId;
        } else {
          // Guests may come with only a name; the phone is a placeholder until someone adds it.
          const [guest] = await tx
            .insert(schema.person)
            .values({ fullName: body.guest.fullName, phone: body.guest.phone ?? '0000000' })
            .returning({ id: schema.person.id });
          teacherId = guest!.id;
          await tx.insert(schema.roleGrant).values({ personId: teacherId, role: 'teacher' });
        }
        if (teacherId === loaded.session.teacherId) throw new Problem(409, 'Esa persona ya lleva esta sesión');
        await tx.insert(schema.sessionHandoff).values({
          sessionId: loaded.session.id,
          fromTeacherId: loaded.session.teacherId,
          toTeacherId: teacherId,
          madeBy: me.id,
          madeAt: now,
        });
        await tx.update(schema.session).set({ teacherId }).where(eq(schema.session.id, loaded.session.id));
        return teacherId;
      });
      const updated = (await loadSession(db, loaded.session.id))!;
      // The previous teacher may no longer see the list; tell the web app where to go.
      if (!canTakeAttendanceFor(me.roles, me.id, toId)) return { handedOff: true };
      return detail(updated, me, now);
    });
  });
}
