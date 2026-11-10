import type { CourseOption, Me, ProgramLeaveResult, StudentEnrollmentRequest, StudentProgram } from '@dah-pango/contracts';
import { schema } from '@dah-pango/db';
import { createTestDb } from '@dah-pango/db/testing';
import { addDays, bogotaDate, bogotaInstant, isoWeekday } from '@dah-pango/domain';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

// The API's clock is 18:30 Bogotá today, inside a semestre around today.
const TODAY = bogotaDate(new Date());
const NOW = bogotaInstant(TODAY, '18:30');
const WEEKDAY = isoWeekday(TODAY);

let db: TestDb;
let app: ReturnType<typeof buildApp>;
let termId: string;
let houseId: string; // At My House
let rougeId: string; // En Rouge
let trackId: string; // a línea of At My House with Funcional and House
let funcional: string; // today 18:00–19:00, in the línea
let house: string; // today 20:00–21:00, in the línea
let hiphop: string; // At My House, today 18:30–19:30: clashes with Funcional
let breaking: string; // At My House, the next day 18:00–19:00
let dancehall: string; // En Rouge, the next day 20:00–21:00
let student: { cookie: string; me: Me };

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'dp_session');
  return c ? `dp_session=${c.value}` : '';
}

async function member(documentNumber: string, fullName: string) {
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
  return { cookie, me };
}

async function enroll(studentId: string, target: { trackId?: string; courseId?: string }, validFrom = addDays(TODAY, -30)) {
  const [change] = await db.insert(schema.enrollmentChange).values({ studentId, effectiveOn: validFrom, madeBy: studentId }).returning();
  const [row] = await db
    .insert(schema.enrollment)
    .values({
      studentId,
      termId,
      trackId: target.trackId ?? null,
      courseId: target.courseId ?? null,
      validFrom,
      validTo: addDays(TODAY, 60),
      openedByChange: change!.id,
    })
    .returning();
  return row!.id;
}

async function newCourse(title: string, program: string | null, weekday: number, startsAt: string, endsAt: string) {
  const [c] = await db.insert(schema.course).values({ programId: program, slug: title.toLowerCase(), title }).returning();
  await db.insert(schema.courseSlot).values({ courseId: c!.id, weekday, startsAt, endsAt });
  return c!.id;
}

const get = <T>(url: string) => app.inject({ method: 'GET', url, headers: { cookie: student.cookie } }).then((r) => r.json() as T);
const post = (url: string, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers: { cookie: student.cookie }, payload });

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
  const programs = await db
    .insert(schema.program)
    .values([
      { slug: 'at-my-house', name: 'At My House' },
      { slug: 'en-rouge', name: 'En Rouge' },
    ])
    .returning();
  houseId = programs[0]!.id;
  rougeId = programs[1]!.id;
  const [track] = await db.insert(schema.track).values({ programId: houseId, slug: 'coreo', name: 'Coreografía' }).returning();
  trackId = track!.id;
  const next = (WEEKDAY % 7) + 1;
  funcional = await newCourse('Funcional', houseId, WEEKDAY, '18:00', '19:00');
  house = await newCourse('House', houseId, WEEKDAY, '20:00', '21:00');
  hiphop = await newCourse('Hip Hop', houseId, WEEKDAY, '18:30', '19:30');
  breaking = await newCourse('Breaking', houseId, next, '18:00', '19:00');
  dancehall = await newCourse('Dancehall', rougeId, next, '20:00', '21:00');
  await db.insert(schema.trackCourse).values([
    { trackId, courseId: funcional },
    { trackId, courseId: house },
  ]);
  student = await member('100', 'Sofía');
});

describe('Mis programas', () => {
  it('lists only the programas the student has clases in, líneas flattened', async () => {
    await enroll(student.me.id, { trackId });
    const programs = await get<StudentProgram[]>('/student/programs');
    expect(programs.map((p) => p.program?.name ?? null)).toEqual(['At My House']);
    expect(programs[0]!.courses.map((c) => c.title)).toEqual(['Funcional', 'House']);
  });

  it('offers the clases not taken yet, marking the ones that clash', async () => {
    await enroll(student.me.id, { trackId });
    const options = await get<CourseOption[]>(`/student/course-options?programId=${houseId}`);
    expect(options.map((o) => [o.title, o.clashesWith])).toEqual([
      ['Hip Hop', ['Funcional']],
      ['Breaking', []],
    ]);
  });

  it('does not count the clase being changed as a clash', async () => {
    await enroll(student.me.id, { trackId });
    const options = await get<CourseOption[]>(`/student/course-options?programId=${houseId}&replacesCourseId=${funcional}`);
    expect(options.find((o) => o.id === hiphop)!.clashesWith).toEqual([]);
  });
});

describe('requests', () => {
  it('asks to add a clase, and marks it as requested', async () => {
    const res = await post('/student/enrollment-requests/join', { courseId: dancehall, note: 'Quiero probar' });
    expect(res.statusCode).toBe(201);
    const request = res.json() as StudentEnrollmentRequest;
    expect(request).toMatchObject({ action: 'join', status: 'pending', programId: rougeId, course: { title: 'Dancehall' } });

    const again = await post('/student/enrollment-requests/join', { courseId: dancehall });
    expect(again.statusCode).toBe(409);
    const options = await get<CourseOption[]>(`/student/course-options?programId=${rougeId}`);
    expect(options[0]!.requested).toBe(true);
  });

  it('refuses a clase that clashes, or one already taken', async () => {
    await enroll(student.me.id, { trackId });
    const clash = await post('/student/enrollment-requests/join', { courseId: hiphop });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toContain('Funcional');
    expect((await post('/student/enrollment-requests/join', { courseId: house })).statusCode).toBe(409);
  });

  it('changes a clase from a línea for another one in the same programa', async () => {
    const enrollmentId = await enroll(student.me.id, { trackId });
    const res = await post('/student/enrollment-requests/swap', { replacesCourseId: funcional, courseId: hiphop });
    expect(res.statusCode).toBe(201);
    const [row] = await db.select().from(schema.enrollmentRequest);
    expect(row).toMatchObject({ action: 'swap', courseId: hiphop, replacesCourseId: funcional, replacesEnrollmentId: enrollmentId });

    const otherProgram = await post('/student/enrollment-requests/swap', { replacesCourseId: house, courseId: dancehall });
    expect(otherProgram.statusCode).toBe(409);
  });

  it('cancels one clase, once', async () => {
    await enroll(student.me.id, { trackId });
    expect((await post('/student/enrollment-requests/leave', { courseId: house })).statusCode).toBe(201);
    expect((await post('/student/enrollment-requests/leave', { courseId: house })).statusCode).toBe(409);
    expect((await post('/student/enrollment-requests/leave', { courseId: dancehall })).statusCode).toBe(404);
    const requests = await get<StudentEnrollmentRequest[]>('/student/enrollment-requests');
    expect(requests.map((r) => [r.action, r.replacesCourse?.title])).toEqual([['leave', 'House']]);
  });
});

describe('leaving a programa', () => {
  it('closes its inscripciones right away and withdraws its pending requests', async () => {
    const running = await enroll(student.me.id, { trackId });
    const future = await enroll(student.me.id, { courseId: breaking }, addDays(TODAY, 3));
    await enroll(student.me.id, { courseId: dancehall });
    await post('/student/enrollment-requests/leave', { courseId: house });

    const res = await post(`/student/programs/${houseId}/leave`);
    expect(res.json()).toEqual({ closedEnrollments: 2, withdrawnRequests: 1 } satisfies ProgramLeaveResult);
    const rows = await db.select().from(schema.enrollment);
    // No clase of the programa started yet today, so it ends yesterday.
    expect(rows.find((e) => e.id === running)!.validTo).toBe(addDays(TODAY, -1));
    expect(rows.find((e) => e.id === future)!.validTo).toBe(addDays(TODAY, 2));
    const [request] = await db.select().from(schema.enrollmentRequest);
    expect(request!.status).toBe('withdrawn');

    const programs = await get<StudentProgram[]>('/student/programs');
    expect(programs.map((p) => [p.program?.name, p.courses.map((c) => c.title)])).toEqual([['En Rouge', ['Dancehall']]]);
    expect((await post(`/student/programs/${houseId}/leave`)).statusCode).toBe(409);
  });

  it('keeps today when one of its clases already started', async () => {
    const running = await enroll(student.me.id, { trackId });
    const [teacher] = await db.select().from(schema.person).where(eq(schema.person.id, student.me.id));
    await db.insert(schema.session).values({
      courseId: funcional,
      termId,
      startsAt: bogotaInstant(TODAY, '18:00'),
      endsAt: bogotaInstant(TODAY, '19:00'),
      teacherId: teacher!.id,
    });
    await post(`/student/programs/${houseId}/leave`);
    const [row] = await db.select().from(schema.enrollment).where(eq(schema.enrollment.id, running));
    expect(row!.validTo).toBe(TODAY);
  });
});
