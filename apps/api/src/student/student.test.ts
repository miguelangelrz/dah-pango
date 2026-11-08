import type { AttendanceSessionDetail, Me, RequestOptions, RequestView, StudentHome } from '@dah-pango/contracts';
import { schema } from '@dah-pango/db';
import { createTestDb } from '@dah-pango/db/testing';
import { addDays, bogotaDate, bogotaInstant, isoWeekday } from '@dah-pango/domain';
import { and, eq, sql } from 'drizzle-orm';
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
let otherProgramId: string;
let trackId: string;
let courseId: string; // Funcional, in the línea, at 18:00–19:00 on today's weekday
let termId: string;
let teacherId: string;
let teacherCookie: string;
let directorCookie: string;

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
  const [other] = await db.insert(schema.program).values({ slug: 'en-rouge', name: 'En Rouge' }).returning();
  otherProgramId = other!.id;
  const [track] = await db.insert(schema.track).values({ programId, slug: 'coreo', name: 'Coreografía' }).returning();
  trackId = track!.id;
  courseId = await newCourse('Funcional', isoWeekday(TODAY), '18:00', '19:00');
  await db.insert(schema.trackCourse).values({ trackId, courseId });
  const teacher = await member('900', ['teacher'], 'Ana Profe');
  teacherId = teacher.me.id;
  teacherCookie = teacher.cookie;
  directorCookie = (await member('901', ['director', 'teacher'], 'Jose Director')).cookie;
});

describe('mis clases', () => {
  it('shows inscripciones, the coming sesiones, past marks and the balance', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const past = await sessionOn(addDays(TODAY, -7));
    await sessionOn(addDays(TODAY, 7));
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.lock_job', 'on', true)`);
      await tx.insert(schema.attendance).values({ sessionId: past, personId: sofia.me.id, state: 'present', origin: 'enrolled' });
    });

    const res = await get('/student/home', sofia.cookie);
    expect(res.statusCode).toBe(200);
    const home = res.json() as StudentHome;
    expect(home.enrollments.map((e) => e.target.name)).toEqual(['Coreografía']);
    expect(home.enrollments[0]!.courses[0]!.slots).toEqual([{ weekday: isoWeekday(TODAY), startsAt: '18:00', endsAt: '19:00' }]);
    expect(home.upcoming).toHaveLength(1);
    expect(home.upcoming[0]!.canNotify).toBe(true);
    expect(home.history.map((s) => [s.id, s.state])).toEqual([[past, 'present']]);
    expect(home.balances).toEqual([{ program: expect.objectContaining({ name: 'At My House' }), balance: 0 }]);
  });

  it('needs a login', async () => {
    expect((await get('/student/home', '')).statusCode).toBe(401);
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

describe('makeup requests', () => {
  it('puts the student on the list once a director approves, and debits when marked', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const houseId = await newCourse('House', 3, '20:00', '21:00');
    const later = await sessionOn(addDays(TODAY, 2), houseId, ['20:00', '21:00']);

    const options = (await get('/student/options', sofia.cookie)).json() as RequestOptions;
    expect(options.makeupSessions.map((s) => s.id)).toEqual([later]);

    const res = await send('POST', '/student/requests/makeup', sofia.cookie, { sessionId: later });
    expect(res.statusCode).toBe(201);
    const request = res.json() as RequestView;
    expect(request).toMatchObject({ kind: 'makeup', status: 'pending', balance: 0 });
    expect((await send('POST', '/student/requests/makeup', sofia.cookie, { sessionId: later })).statusCode).toBe(409);

    // Students and teachers don't review.
    expect((await get('/requests', sofia.cookie)).statusCode).toBe(403);
    expect((await get('/requests', teacherCookie)).statusCode).toBe(403);
    const pending = (await get('/requests', directorCookie)).json() as RequestView[];
    expect(pending.map((r) => r.id)).toEqual([request.id]);

    const approved = await send('POST', `/requests/makeup/${request.id}/review`, directorCookie, { decision: 'approve', reply: 'Listo' });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual([]);

    const detail = (await get(`/attendance/sessions/${later}`, teacherCookie)).json() as AttendanceSessionDetail;
    expect(detail.roster).toEqual([expect.objectContaining({ personId: sofia.me.id, origin: 'makeup', state: null })]);
    const home = (await get('/student/home', sofia.cookie)).json() as StudentHome;
    expect(home.upcoming.find((s) => s.id === later)).toMatchObject({ origin: 'makeup', canNotify: false });

    // Once the clase runs, the teacher marks it and the ledger is debited.
    const [row] = await db
      .update(schema.session)
      .set({ startsAt: bogotaInstant(TODAY, '18:00'), endsAt: bogotaInstant(TODAY, '19:00') })
      .where(eq(schema.session.id, later))
      .returning();
    expect(row).toBeTruthy();
    const marked = await send('PUT', `/attendance/sessions/${later}/marks`, teacherCookie, {
      marks: [{ personId: sofia.me.id, state: 'makeup' }],
    });
    expect(marked.statusCode).toBe(200);
    const [mark] = await db.select().from(schema.attendance).where(eq(schema.attendance.sessionId, later));
    expect(mark!.makeupRequestId).toBe(request.id);
    expect((await ledger(sofia.me.id)).map((l) => [l.reason, l.delta])).toEqual([['makeup', -1]]);
    const removed = await send('DELETE', `/attendance/sessions/${later}/people/${sofia.me.id}`, teacherCookie);
    expect(removed.statusCode).toBe(409);
  });

  it('keeps reposiciones in the student’s programa or a general clase', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const rouge = await newCourse('Dancehall', 2, '18:00', '19:00', otherProgramId);
    const elsewhere = await sessionOn(addDays(TODAY, 2), rouge);
    const res = await send('POST', '/student/requests/makeup', sofia.cookie, { sessionId: elsewhere });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/mismo programa/);

    const general = await newCourse('All Styles', 6, '10:00', '12:00', null);
    const open = await sessionOn(addDays(TODAY, 2), general, ['10:00', '12:00']);
    const ok = await send('POST', '/student/requests/makeup', sofia.cookie, { sessionId: open });
    expect(ok.statusCode).toBe(201);
    // Counts against the programa she is enrolled in.
    expect((ok.json() as RequestView & { kind: 'makeup' }).program.id).toBe(programId);
  });

  it('can be withdrawn, and denied with a reply', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const houseId = await newCourse('House', 3, '20:00', '21:00');
    const a = await sessionOn(addDays(TODAY, 2), houseId, ['20:00', '21:00']);
    const b = await sessionOn(addDays(TODAY, 9), houseId, ['20:00', '21:00']);
    const first = (await send('POST', '/student/requests/makeup', sofia.cookie, { sessionId: a })).json() as RequestView;
    const second = (await send('POST', '/student/requests/makeup', sofia.cookie, { sessionId: b })).json() as RequestView;
    expect((await send('POST', `/student/requests/makeup/${first.id}/withdraw`, sofia.cookie)).statusCode).toBe(200);
    await send('POST', `/requests/makeup/${second.id}/review`, directorCookie, { decision: 'deny', reply: 'Está llena' });
    const mine = (await get('/student/requests', sofia.cookie)).json() as RequestView[];
    expect(mine.map((r) => [r.id, r.status, r.reply])).toEqual(
      expect.arrayContaining([
        [first.id, 'withdrawn', null],
        [second.id, 'denied', 'Está llena'],
      ]),
    );
    expect((await send('POST', `/requests/makeup/${second.id}/review`, directorCookie, { decision: 'approve' })).statusCode).toBe(409);
  });
});

describe('enrollment requests', () => {
  it('opens an inscripción from the date the director sets, and records the change', async () => {
    const sofia = await member('100', [], 'Sofía');
    const hipHop = await newCourse('Hip Hop', 2, '19:00', '20:00');
    const res = await send('POST', '/student/requests/enrollment', sofia.cookie, {
      action: 'join',
      courseId: hipHop,
      wantedStart: addDays(TODAY, 1),
      note: 'Quiero empezar ya',
    });
    expect(res.statusCode).toBe(201);
    const request = res.json() as RequestView;
    expect(request).toMatchObject({ kind: 'enrollment', action: 'join', wantedStart: addDays(TODAY, 1), clashes: [] });

    const start = addDays(TODAY, 5);
    const ok = await send('POST', `/requests/enrollment/${request.id}/review`, directorCookie, { decision: 'approve', approvedStart: start });
    expect(ok.statusCode).toBe(200);
    const [enrollment] = await db.select().from(schema.enrollment).where(eq(schema.enrollment.studentId, sofia.me.id));
    expect(enrollment).toMatchObject({ courseId: hipHop, validFrom: start, validTo: addDays(TODAY, 60) });
    const [change] = await db.select().from(schema.enrollmentChange).where(eq(schema.enrollmentChange.id, enrollment!.openedByChange));
    expect(change).toMatchObject({ requestId: request.id, effectiveOn: start, reason: 'Inscripción' });
    const [stored] = await db.select().from(schema.enrollmentRequest).where(eq(schema.enrollmentRequest.id, request.id));
    expect(stored).toMatchObject({ status: 'approved', approvedStart: start });
  });

  it('refuses clases that overlap the student’s schedule', async () => {
    const sofia = await member('100', [], 'Sofía');
    await enroll(sofia.me.id);
    const clash = await newCourse('Breaking', isoWeekday(TODAY), '18:30', '19:30');
    const res = await send('POST', '/student/requests/enrollment', sofia.cookie, { action: 'join', courseId: clash });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Se cruza en horario con Funcional/);
    const again = await send('POST', '/student/requests/enrollment', sofia.cookie, { action: 'join', trackId });
    expect(again.json().error).toMatch(/Ya estás inscrito/);
  });

  it('swaps: closes the old inscripción the day before and opens the new one', async () => {
    const sofia = await member('100', [], 'Sofía');
    const old = await enroll(sofia.me.id);
    // Same hour as Funcional: fine, since the swap frees that hour.
    const breaking = await newCourse('Breaking', isoWeekday(TODAY), '18:30', '19:30');
    const swap = await send('POST', '/student/requests/enrollment', sofia.cookie, {
      action: 'swap',
      replacesEnrollmentId: old,
      courseId: breaking,
      wantedStart: addDays(TODAY, 7),
    });
    expect(swap.statusCode).toBe(201);
    const request = swap.json() as RequestView;
    expect(request).toMatchObject({ replaces: { id: old, name: 'Coreografía' }, clashes: [] });
    expect((await send('POST', `/requests/enrollment/${request.id}/review`, directorCookie, { decision: 'approve' })).statusCode).toBe(200);

    const rows = await db.select().from(schema.enrollment).where(eq(schema.enrollment.studentId, sofia.me.id));
    expect(rows.find((r) => r.id === old)).toMatchObject({ validTo: addDays(TODAY, 6) });
    expect(rows.find((r) => r.id !== old)).toMatchObject({ courseId: breaking, validFrom: addDays(TODAY, 7) });
    const changes = await db
      .select()
      .from(schema.enrollmentChange)
      .where(and(eq(schema.enrollmentChange.studentId, sofia.me.id), eq(schema.enrollmentChange.requestId, request.id)));
    expect(changes).toHaveLength(1);
    expect(rows.find((r) => r.id === old)!.closedByChange).toBe(changes[0]!.id);
  });

  it('leaves from a date, never before today', async () => {
    const sofia = await member('100', [], 'Sofía');
    const old = await enroll(sofia.me.id);
    const early = await send('POST', '/student/requests/enrollment', sofia.cookie, {
      action: 'leave',
      replacesEnrollmentId: old,
      wantedStart: addDays(TODAY, -1),
    });
    expect(early.json().error).toMatch(/antes de hoy/);
    const leave = (await send('POST', '/student/requests/enrollment', sofia.cookie, { action: 'leave', replacesEnrollmentId: old })).json() as RequestView;
    await send('POST', `/requests/enrollment/${leave.id}/review`, directorCookie, { decision: 'approve' });
    const [row] = await db.select().from(schema.enrollment).where(eq(schema.enrollment.id, old));
    expect(row!.validTo).toBe(addDays(TODAY, -1));
    const home = (await get('/student/home', sofia.cookie)).json() as StudentHome;
    expect(home.enrollments).toEqual([]);
  });
});
