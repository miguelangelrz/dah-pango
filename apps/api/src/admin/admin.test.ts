import type { AdminCourse, AdminTerm, Me, SessionSyncSummary } from '@dah-pango/contracts';
import { schema } from '@dah-pango/db';
import { createTestDb } from '@dah-pango/db/testing';
import { bogotaInstant } from '@dah-pango/domain';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

// Friday 6 November 2026, 10:00 in Bogotá.
const NOW = new Date('2026-11-06T15:00:00Z');

let db: TestDb;
let app: ReturnType<typeof buildApp>;
let courseId: string;

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'dp_session');
  return c ? `dp_session=${c.value}` : '';
}

/** Signs someone up, accepts the legal documents and gives them extra roles. */
async function member(documentNumber: string, roles: ('admin' | 'teacher')[] = []) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { fullName: 'Persona Prueba', documentType: 'CC', documentNumber, phone: '3001234567', password: 'clave-segura' },
  });
  const cookie = cookieOf(res);
  const me = res.json() as Me;
  await app.inject({
    method: 'POST',
    url: '/auth/consents',
    headers: { cookie },
    payload: { legalDocumentIds: me.pendingLegalDocuments.map((d) => d.id) },
  });
  for (const role of roles) await db.insert(schema.roleGrant).values({ personId: me.id, role });
  return { cookie, me };
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  app = buildApp({ db, clock: () => NOW });
  await db.insert(schema.legalDocument).values([
    { kind: 'terms', version: '1', body: 't', publishedAt: new Date('2026-07-01') },
    { kind: 'data_policy', version: '1', body: 'd', publishedAt: new Date('2026-07-01') },
  ]);
  const [program] = await db.insert(schema.program).values({ slug: 'at-my-house', name: 'At My House' }).returning();
  const [teacher] = await db.insert(schema.person).values({ fullName: 'Jose Luis Cuesta', phone: '0000000' }).returning();
  const [course] = await db
    .insert(schema.course)
    .values({ programId: program!.id, slug: 'funcional', title: 'Funcional', defaultTeacherId: teacher!.id })
    .returning();
  courseId = course!.id;
  await db.insert(schema.courseSlot).values({ courseId, weekday: 3, startsAt: '18:00', endsAt: '19:00' });
});

async function createTerm(cookie: string, body = { name: 'Segundo semestre 2026', startsOn: '2026-07-06', endsOn: '2026-12-20' }) {
  const res = await app.inject({ method: 'POST', url: '/admin/terms', headers: { cookie }, payload: body });
  return { res, body: res.json() as { term: AdminTerm; sessions: SessionSyncSummary } };
}

function sessionsOf(id = courseId) {
  return db.select().from(schema.session).where(eq(schema.session.courseId, id)).orderBy(asc(schema.session.startsAt));
}

describe('who can configure', () => {
  it('lets a super admin in and gives them every permission', async () => {
    const { cookie } = await member('111', ['admin']);
    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).json() as Me;
    expect(me.permissions).toContain('configure_academy');
    const res = await app.inject({ method: 'GET', url: '/admin/terms', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('keeps students and teachers out', async () => {
    const { cookie } = await member('222', ['teacher']);
    const res = await app.inject({ method: 'GET', url: '/admin/courses', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/courses' })).statusCode).toBe(401);
  });
});

describe('semestres and bloques', () => {
  it('creates a semestre with its bloques and only the sesiones still ahead', async () => {
    const { cookie } = await member('111', ['admin']);
    const { res, body } = await createTerm(cookie);
    expect(res.statusCode).toBe(201);
    expect(body.term.blocks).toHaveLength(6);
    expect(body.term.blocks[0]).toMatchObject({ number: 1, startsOn: '2026-07-06', endsOn: '2026-08-02' });
    // Wednesdays from 11 November to 16 December.
    expect(body.sessions.created).toBe(6);
    const sessions = await sessionsOf();
    expect(sessions[0]?.startsAt).toEqual(bogotaInstant('2026-11-11', '18:00'));
    const [block5] = await db.select().from(schema.block).where(eq(schema.block.number, 5));
    expect(sessions[0]?.blockId).toBe(block5?.id);
  });

  it('rejects overlapping semestres', async () => {
    const { cookie } = await member('111', ['admin']);
    await createTerm(cookie);
    const { res } = await createTerm(cookie, { name: 'Otro', startsOn: '2026-12-01', endsOn: '2027-06-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/se cruzan/);
  });

  it('moves the end of a semestre: bloques and sesiones follow', async () => {
    const { cookie } = await member('111', ['admin']);
    const { body } = await createTerm(cookie);
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/terms/${body.term.id}`,
      headers: { cookie },
      payload: { name: 'Segundo semestre 2026', startsOn: '2026-07-06', endsOn: '2026-12-06' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as { term: AdminTerm; sessions: SessionSyncSummary };
    expect(updated.term.blocks.at(-1)?.endsOn).toBe('2026-12-06');
    expect(updated.sessions.removed).toBe(2); // 9 and 16 December
    expect(await sessionsOf()).toHaveLength(4);
  });

  it('does not move the start of a semestre that already began', async () => {
    const { cookie } = await member('111', ['admin']);
    const { body } = await createTerm(cookie);
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/terms/${body.term.id}`,
      headers: { cookie },
      payload: { name: 'Segundo semestre 2026', startsOn: '2026-07-13', endsOn: '2026-12-20' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('saves bloques edited by hand and re-points sesiones', async () => {
    const { cookie } = await member('111', ['admin']);
    const { body } = await createTerm(cookie);
    const blocks = [
      { startsOn: '2026-07-06', endsOn: '2026-08-02' },
      { startsOn: '2026-08-03', endsOn: '2026-11-15' },
      { startsOn: '2026-11-16', endsOn: '2026-12-20' },
    ];
    const res = await app.inject({ method: 'PUT', url: `/admin/terms/${body.term.id}/blocks`, headers: { cookie }, payload: { blocks } });
    expect(res.statusCode).toBe(200);
    const [first, second] = await sessionsOf();
    const saved = await db.select().from(schema.block).orderBy(asc(schema.block.number));
    expect(saved).toHaveLength(3);
    expect(first?.blockId).toBe(saved[1]?.id);
    expect(second?.blockId).toBe(saved[2]?.id);

    const bad = await app.inject({
      method: 'PUT',
      url: `/admin/terms/${body.term.id}/blocks`,
      headers: { cookie },
      payload: { blocks: [{ startsOn: '2026-07-01', endsOn: '2026-08-02' }] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('class schedules', () => {
  it('changes the duration and the day of a clase, keeping sesiones with records', async () => {
    const { cookie, me } = await member('111', ['admin']);
    await createTerm(cookie);
    const before = await sessionsOf();
    // Someone already sent an absence notice for 18 November.
    await db.insert(schema.absenceNotice).values({ sessionId: before[1]!.id, personId: me.id });

    const res = await app.inject({
      method: 'PUT',
      url: `/admin/courses/${courseId}/slots`,
      headers: { cookie },
      payload: { slots: [{ weekday: 4, startsAt: '18:00', durationMinutes: 90 }] },
    });
    expect(res.statusCode).toBe(200);
    const { course, sessions } = res.json() as { course: AdminCourse; sessions: SessionSyncSummary };
    expect(course.slots).toEqual([{ weekday: 4, startsAt: '18:00', endsAt: '19:30', durationMinutes: 90 }]);
    expect(sessions).toEqual({ created: 6, updated: 0, removed: 5, kept: 1 });

    const after = await sessionsOf();
    expect(after.map((s) => s.id)).toContain(before[1]!.id);
    const thursdays = after.filter((s) => s.id !== before[1]!.id);
    expect(thursdays[0]?.startsAt).toEqual(bogotaInstant('2026-11-12', '18:00'));
    expect(thursdays[0]?.endsAt).toEqual(bogotaInstant('2026-11-12', '19:30'));
  });

  it('only stretches upcoming sesiones when the duration changes', async () => {
    const { cookie } = await member('111', ['admin']);
    const [term] = await db.insert(schema.term).values({ name: 'T', startsOn: '2026-11-01', endsOn: '2026-11-30' }).returning();
    const [course] = await db.select().from(schema.course);
    await db.insert(schema.session).values({
      courseId,
      termId: term!.id,
      startsAt: bogotaInstant('2026-11-04', '18:00'),
      endsAt: bogotaInstant('2026-11-04', '19:00'),
      teacherId: course!.defaultTeacherId!,
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/courses/${courseId}/slots`,
      headers: { cookie },
      payload: { slots: [{ weekday: 3, startsAt: '18:00', durationMinutes: 120 }] },
    });
    // 11, 18 and 25 November.
    expect(res.json().sessions).toEqual({ created: 3, updated: 0, removed: 0, kept: 0 });
    const [past] = await db
      .select()
      .from(schema.session)
      .where(and(eq(schema.session.courseId, courseId), eq(schema.session.startsAt, bogotaInstant('2026-11-04', '18:00'))));
    expect(past?.endsAt).toEqual(bogotaInstant('2026-11-04', '19:00'));
  });

  it('rejects overlapping slots and sesiones past midnight', async () => {
    const { cookie } = await member('111', ['admin']);
    const overlap = await app.inject({
      method: 'PUT',
      url: `/admin/courses/${courseId}/slots`,
      headers: { cookie },
      payload: {
        slots: [
          { weekday: 1, startsAt: '18:00', durationMinutes: 90 },
          { weekday: 1, startsAt: '19:00', durationMinutes: 60 },
        ],
      },
    });
    expect(overlap.statusCode).toBe(400);
    const late = await app.inject({
      method: 'PUT',
      url: `/admin/courses/${courseId}/slots`,
      headers: { cookie },
      payload: { slots: [{ weekday: 1, startsAt: '23:30', durationMinutes: 60 }] },
    });
    expect(late.statusCode).toBe(400);
  });
});
