import type { MakeupBalance, Me, StudentClassDays, StudentSession } from '@dah-pango/contracts';
import { schema } from '@dah-pango/db';
import { createTestDb } from '@dah-pango/db/testing';
import { addDays, bogotaDate, bogotaInstant, isoWeekday } from '@dah-pango/domain';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

// Like the attendance tests: sesiones sit around today's real date (the lock trigger uses the
// database clock) and the API's clock is 18:30 Bogotá today.
const TODAY = bogotaDate(new Date());
const NOW = bogotaInstant(TODAY, '18:30');

let db: TestDb;
let app: ReturnType<typeof buildApp>;
let programId: string;
let trackId: string;
let courseId: string; // Funcional, in the línea, at 18:00–19:00 on today's weekday
let termId: string;
let teacherId: string;

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

async function enroll(studentId: string, target: { trackId?: string; courseId?: string } = { trackId }) {
  const [change] = await db
    .insert(schema.enrollmentChange)
    .values({ studentId, effectiveOn: addDays(TODAY, -30), madeBy: studentId })
    .returning();
  const [row] = await db
    .insert(schema.enrollment)
    .values({
      studentId,
      termId,
      trackId: target.trackId ?? null,
      courseId: target.courseId ?? null,
      validFrom: addDays(TODAY, -30),
      validTo: addDays(TODAY, 60),
      openedByChange: change!.id,
    })
    .returning();
  return row!.id;
}

async function newCourse(slug: string, weekday: number, startsAt: string, endsAt: string, program: string | null = programId) {
  const [c] = await db.insert(schema.course).values({ programId: program, slug, title: slug }).returning();
  await db.insert(schema.courseSlot).values({ courseId: c!.id, weekday, startsAt, endsAt });
  return c!.id;
}

async function sessionOn(date: string, course = courseId, time: [string, string] = ['18:00', '19:00']) {
  const [s] = await db
    .insert(schema.session)
    .values({
      courseId: course,
      termId,
      startsAt: bogotaInstant(date, time[0]),
      endsAt: bogotaInstant(date, time[1]),
      teacherId,
    })
    .returning();
  return s!.id;
}

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const send = (method: 'PUT' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });
const ledger = (personId: string) => db.select().from(schema.makeupLedger).where(eq(schema.makeupLedger.personId, personId));

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
  const [track] = await db.insert(schema.track).values({ programId, slug: 'coreo', name: 'Coreografía' }).returning();
  trackId = track!.id;
  courseId = await newCourse('Funcional', isoWeekday(TODAY), '18:00', '19:00');
  await db.insert(schema.trackCourse).values({ trackId, courseId });
  const teacher = await member('900', ['teacher'], 'Ana Profe');
  teacherId = teacher.me.id;
});

describe('class days', () => {
  it('shows three days with clases at a time, skipping empty days, and pages both ways', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const dates = [0, 1, 7, 8, 14].map((d) => addDays(TODAY, d));
    for (const d of dates) await sessionOn(d, courseId, ['20:00', '21:00']);

    const first = (await get('/student/sessions', sofia.cookie)).json() as StudentClassDays;
    expect(first.from).toBe(TODAY);
    expect(first.days.map((d) => d.date)).toEqual(dates.slice(0, 3));
    expect(first.days[0]!.sessions[0]!.canNotify).toBe(false); // less than 24 hours away
    expect(first.days[2]!.sessions[0]!.canNotify).toBe(true);
    expect(first.prevFrom).toBeNull();
    expect(first.nextFrom).toBe(dates[3]);

    const second = (await get(`/student/sessions?from=${first.nextFrom}`, sofia.cookie)).json() as StudentClassDays;
    expect(second.days.map((d) => d.date)).toEqual(dates.slice(3));
    expect(second.nextFrom).toBeNull();
    expect(second.prevFrom).toBe(dates[0]);
  });

  it('needs a login', async () => {
    expect((await get('/student/sessions', '')).statusCode).toBe(401);
  });
});

describe('history and makeup balances', () => {
  it('lists this semestre’s past sesiones with their marks, and the balance per programa', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const past = await sessionOn(addDays(TODAY, -7));
    await sessionOn(addDays(TODAY, 7));
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.lock_job', 'on', true)`);
      await tx.insert(schema.attendance).values({ sessionId: past, personId: sofia.me.id, state: 'present', origin: 'enrolled' });
    });

    const history = (await get('/student/history', sofia.cookie)).json() as StudentSession[];
    expect(history.map((s) => [s.id, s.state])).toEqual([[past, 'present']]);
    const balances = (await get('/student/makeup-balances', sofia.cookie)).json() as MakeupBalance[];
    expect(balances).toEqual([{ program: expect.objectContaining({ name: 'At My House' }), balance: 0 }]);
  });
});

describe('absence notice', () => {
  it('marks Falta con aviso and earns a credit until 24 hours before', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const later = await sessionOn(addDays(TODAY, 3));
    const res = await send('POST', `/student/sessions/${later}/notice`, sofia.cookie, { note: 'Viaje' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'excused', noticeSent: true });
    expect((await ledger(sofia.me.id)).map((l) => [l.reason, l.delta])).toEqual([['notice', 1]]);
    const [event] = await db.select().from(schema.attendanceEvent);
    expect(event).toMatchObject({ newState: 'excused', source: 'notice', madeBy: sofia.me.id });
    expect((await send('POST', `/student/sessions/${later}/notice`, sofia.cookie)).statusCode).toBe(409);

    // Tomorrow at 18:00 is less than 24 hours away.
    const tomorrow = await sessionOn(addDays(TODAY, 1));
    const late = await send('POST', `/student/sessions/${tomorrow}/notice`, sofia.cookie);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toMatch(/24 horas/);
  });

  it('refuses sesiones the student isn’t enrolled in', async () => {
    const tomas = await member('101', [], 'Tomás');
    const later = await sessionOn(addDays(TODAY, 3));
    expect((await send('POST', `/student/sessions/${later}/notice`, tomas.cookie)).statusCode).toBe(409);
  });
});
