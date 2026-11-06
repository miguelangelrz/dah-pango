import type { AttendanceDay, AttendanceSessionDetail, Me } from '@dah-pango/contracts';
import { schema } from '@dah-pango/db';
import { createTestDb } from '@dah-pango/db/testing';
import { addDays, bogotaDate, bogotaInstant } from '@dah-pango/domain';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

// The lock trigger compares with the database clock, so the sesiones sit around today's
// real date and the API's clock is 18:30 Bogotá on that day.
const TODAY = bogotaDate(new Date());
const NOW = bogotaInstant(TODAY, '18:30');

let db: TestDb;
let app: ReturnType<typeof buildApp>;
let programId: string;
let trackId: string;
let courseId: string;
let termId: string;

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'dp_session');
  return c ? `dp_session=${c.value}` : '';
}

async function member(documentNumber: string, roles: ('admin' | 'teacher' | 'director')[] = [], fullName = 'Persona Prueba') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { fullName, documentType: 'CC', documentNumber, phone: '3001234567', password: 'clave-segura' },
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

async function student(fullName: string, target: { trackId?: string; courseId?: string } = { trackId }) {
  const [p] = await db.insert(schema.person).values({ fullName, phone: '3000000000' }).returning();
  const [change] = await db
    .insert(schema.enrollmentChange)
    .values({ studentId: p!.id, effectiveOn: addDays(TODAY, -30), madeBy: p!.id })
    .returning();
  await db.insert(schema.enrollment).values({
    studentId: p!.id,
    termId,
    trackId: target.trackId ?? null,
    courseId: target.courseId ?? null,
    validFrom: addDays(TODAY, -30),
    validTo: addDays(TODAY, 60),
    openedByChange: change!.id,
  });
  return p!.id;
}

async function sessionOn(date: string, teacherId: string, course = courseId) {
  const [s] = await db
    .insert(schema.session)
    .values({
      courseId: course,
      termId,
      startsAt: bogotaInstant(date, '18:00'),
      endsAt: bogotaInstant(date, '19:00'),
      teacherId,
    })
    .returning();
  return s!.id;
}

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const send = (method: 'PUT' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });

function ledger(personId: string) {
  return db.select().from(schema.makeupLedger).where(eq(schema.makeupLedger.personId, personId));
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  app = buildApp({ db, clock: () => NOW });
  await db.insert(schema.legalDocument).values([
    { kind: 'terms', version: '1', body: 't', publishedAt: new Date('2026-07-01') },
    { kind: 'data_policy', version: '1', body: 'd', publishedAt: new Date('2026-07-01') },
  ]);
  const [term] = await db
    .insert(schema.term)
    .values({ name: 'Semestre', startsOn: addDays(TODAY, -60), endsOn: addDays(TODAY, 60) })
    .returning();
  termId = term!.id;
  const [program] = await db.insert(schema.program).values({ slug: 'at-my-house', name: 'At My House' }).returning();
  programId = program!.id;
  const [track] = await db
    .insert(schema.track)
    .values({ programId, slug: 'coreografia-funcional', name: 'Coreografía + Funcional' })
    .returning();
  trackId = track!.id;
  const [course] = await db
    .insert(schema.course)
    .values({ programId, slug: 'funcional', title: 'Funcional' })
    .returning();
  courseId = course!.id;
  await db.insert(schema.trackCourse).values({ trackId, courseId });
});

describe('who sees what', () => {
  it('shows a teacher their sesiones of the day, and keeps others out', async () => {
    const ana = await member('111', ['teacher'], 'Ana Profe');
    const luis = await member('222', ['teacher'], 'Luis Profe');
    const mine = await sessionOn(TODAY, ana.me.id);
    const [house] = await db.insert(schema.course).values({ programId, slug: 'house', title: 'House' }).returning();
    await sessionOn(TODAY, luis.me.id, house!.id);

    const day = (await get('/attendance/day', ana.cookie)).json() as AttendanceDay;
    expect(day.date).toBe(TODAY);
    expect(day.sessions.map((s) => s.id)).toEqual([mine]);
    expect((await get(`/attendance/sessions/${mine}`, luis.cookie)).statusCode).toBe(403);

    const admin = await member('333', ['admin']);
    const all = (await get('/attendance/day', admin.cookie)).json() as AttendanceDay;
    expect(all.sessions).toHaveLength(2);
    expect((await get(`/attendance/sessions/${mine}`, admin.cookie)).statusCode).toBe(200);

    const learner = await member('444');
    expect((await get('/attendance/day', learner.cookie)).statusCode).toBe(403);
  });
});

describe('taking attendance', () => {
  it('lists students enrolled through the línea and logs every mark', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(TODAY, ana.me.id);
    const sofia = await student('Sofía');
    const tomas = await student('Tomás', { courseId });

    let detail = (await get(`/attendance/sessions/${s}`, ana.cookie)).json() as AttendanceSessionDetail;
    expect(detail.roster.map((r) => r.fullName)).toEqual(['Sofía', 'Tomás']);
    expect(detail.canEdit && detail.canMarkToday).toBe(true);

    const res = await send('PUT', `/attendance/sessions/${s}/marks`, ana.cookie, {
      marks: [
        { personId: sofia, state: 'present' },
        { personId: tomas, state: 'excused' },
      ],
    });
    expect(res.statusCode).toBe(200);
    detail = res.json() as AttendanceSessionDetail;
    expect(detail.counts).toEqual({ listed: 2, marked: 2 });
    expect(detail.roster.find((r) => r.personId === tomas)?.balance).toBe(1);

    // Changing Falta con aviso to Asistió takes the credit back.
    await send('PUT', `/attendance/sessions/${s}/marks`, ana.cookie, { marks: [{ personId: tomas, state: 'present' }] });
    expect((await ledger(tomas)).map((l) => [l.reason, l.delta])).toEqual([
      ['notice', 1],
      ['reversal', -1],
    ]);
    const events = await db.select().from(schema.attendanceEvent).where(eq(schema.attendanceEvent.personId, tomas));
    expect(events.map((e) => [e.oldState, e.newState, e.source])).toEqual([
      [null, 'excused', 'teacher'],
      ['excused', 'present', 'teacher'],
    ]);
  });

  it('only takes Falta con aviso before the session day', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(addDays(TODAY, 2), ana.me.id);
    const sofia = await student('Sofía');
    const early = await send('PUT', `/attendance/sessions/${s}/marks`, ana.cookie, { marks: [{ personId: sofia, state: 'present' }] });
    expect(early.statusCode).toBe(409);
    const ok = await send('PUT', `/attendance/sessions/${s}/marks`, ana.cookie, { marks: [{ personId: sofia, state: 'excused' }] });
    expect(ok.statusCode).toBe(200);
  });

  it('logs a director covering a guest teacher as director', async () => {
    const [guest] = await db.insert(schema.person).values({ fullName: 'Invitada', phone: '0000000' }).returning();
    const s = await sessionOn(TODAY, guest!.id);
    const sofia = await student('Sofía');
    const jose = await member('555', ['director', 'teacher']);
    await send('PUT', `/attendance/sessions/${s}/marks`, jose.cookie, { marks: [{ personId: sofia, state: 'present' }] });
    const [event] = await db.select().from(schema.attendanceEvent);
    expect(event?.source).toBe('director');
  });
});

describe('makeups and walk-ins', () => {
  it('adds a makeup that uses a credit, and takes it back when removed', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(TODAY, ana.me.id);
    const [visitor] = await db.insert(schema.person).values({ fullName: 'Valentina Ruiz', phone: '3000000000', documentType: 'CC', documentNumber: '1020300' }).returning();

    const found = (await get(`/attendance/sessions/${s}/people?q=1020`, ana.cookie)).json() as { id: string }[];
    expect(found.map((p) => p.id)).toEqual([visitor!.id]);

    const res = await send('POST', `/attendance/sessions/${s}/makeups`, ana.cookie, { personId: visitor!.id });
    expect(res.statusCode).toBe(201);
    const row = (res.json() as AttendanceSessionDetail).roster.find((r) => r.personId === visitor!.id);
    expect(row).toMatchObject({ origin: 'makeup', state: 'makeup', balance: -1 });
    expect((await send('POST', `/attendance/sessions/${s}/makeups`, ana.cookie, { personId: visitor!.id })).statusCode).toBe(409);

    const removed = await send('DELETE', `/attendance/sessions/${s}/people/${visitor!.id}`, ana.cookie);
    expect((removed.json() as AttendanceSessionDetail).roster).toHaveLength(0);
    expect((await ledger(visitor!.id)).reduce((n, l) => n + l.delta, 0)).toBe(0);
  });

  it('adds a walk-in as present, whose history joins the account they open later', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(TODAY, ana.me.id);
    const res = await send('POST', `/attendance/sessions/${s}/walk-ins`, ana.cookie, {
      fullName: 'Mateo Gómez',
      phone: '3101234567',
      documentType: 'CC',
      documentNumber: '1.033.444',
    });
    expect(res.statusCode).toBe(201);
    const row = (res.json() as AttendanceSessionDetail).roster[0]!;
    expect(row).toMatchObject({ origin: 'walk_in', state: 'present', document: 'CC 1033444', hasAccount: false });

    const later = await member('1033444', [], 'Mateo Gómez');
    expect(later.me.id).toBe(row.personId);
  });

  it('refuses a walk-in without a phone', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(TODAY, ana.me.id);
    const res = await send('POST', `/attendance/sessions/${s}/walk-ins`, ana.cookie, { fullName: 'Mateo Gómez' });
    expect(res.statusCode).toBe(400);
  });
});

describe('the lock', () => {
  it('turns unmarked students into Falta 24 hours after the end and allows no more changes', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(addDays(TODAY, -3), ana.me.id);
    const sofia = await student('Sofía');

    const detail = (await get(`/attendance/sessions/${s}`, ana.cookie)).json() as AttendanceSessionDetail;
    expect(detail.locked).toBe(true);
    expect(detail.canEdit).toBe(false);
    expect(detail.roster[0]?.state).toBe('absent');
    const [event] = await db.select().from(schema.attendanceEvent).where(eq(schema.attendanceEvent.sessionId, s));
    expect(event?.source).toBe('lock');

    const res = await send('PUT', `/attendance/sessions/${s}/marks`, ana.cookie, { marks: [{ personId: sofia, state: 'present' }] });
    expect(res.statusCode).toBe(409);
  });

  it('lists yesterday’s open sesiones with students left to mark', async () => {
    const ana = await member('111', ['teacher']);
    const yesterday = addDays(TODAY, -1);
    const [s] = await db
      .insert(schema.session)
      .values({ courseId, termId, startsAt: bogotaInstant(yesterday, '20:00'), endsAt: bogotaInstant(yesterday, '21:00'), teacherId: ana.me.id })
      .returning();
    await student('Sofía');
    const day = (await get('/attendance/day', ana.cookie)).json() as AttendanceDay;
    expect(day.pending.map((p) => p.id)).toEqual([s!.id]);
  });
});

describe('handing a sesión over', () => {
  it('passes it to a guest teacher; the director then takes attendance', async () => {
    const ana = await member('111', ['teacher']);
    const s = await sessionOn(TODAY, ana.me.id);
    const res = await send('PUT', `/attendance/sessions/${s}/teacher`, ana.cookie, { guest: { fullName: 'Profe Invitada' } });
    expect(res.json()).toEqual({ handedOff: true });
    expect((await get(`/attendance/sessions/${s}`, ana.cookie)).statusCode).toBe(403);

    const admin = await member('333', ['admin']);
    const detail = (await get(`/attendance/sessions/${s}`, admin.cookie)).json() as AttendanceSessionDetail;
    expect(detail.teacher).toMatchObject({ fullName: 'Profe Invitada', hasAccount: false });
    expect(detail.handoffs).toHaveLength(1);
    const [log] = await db.select().from(schema.sessionHandoff).where(and(eq(schema.sessionHandoff.sessionId, s)));
    expect(log?.fromTeacherId).toBe(ana.me.id);
  });

  it('passes it to another teacher, who can then take it', async () => {
    const ana = await member('111', ['teacher']);
    const luis = await member('222', ['teacher'], 'Luis Profe');
    const s = await sessionOn(TODAY, ana.me.id);
    await send('PUT', `/attendance/sessions/${s}/teacher`, ana.cookie, { teacherId: luis.me.id });
    expect((await get(`/attendance/sessions/${s}`, luis.cookie)).statusCode).toBe(200);
  });
});
