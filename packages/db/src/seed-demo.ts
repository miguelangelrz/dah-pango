import {
  addDays,
  bogotaDate,
  daysBetween,
  enrolledOn,
  findOverlaps,
  isLocked,
  ledgerEffect,
  type AttendanceState,
  type DatedEnrollment,
  type ScheduledCourse,
} from '@dah-pango/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './index';
import { hashPassword } from './password';
import * as schema from './schema';

// Simulated people so attendance can be tried: a teacher with an account, students
// enrolled in líneas and clases, and the semestre's history up to today (attendance,
// notices, makeups, walk-ins). Everything is random but repeatable. Never run in production.

export const DEMO_PASSWORD = 'dahpango123';
export const DEMO_TEACHER = { fullName: 'Laura Méndez', documentType: 'CC', documentNumber: '1000000001' } as const;
/** Clases the demo teacher leads, so the teacher view has something on several days. */
const DEMO_TEACHER_COURSES = [
  'semilleros-avanzado-hip-hop',
  'semilleros-avanzado-house',
  'semilleros-inicial-hip-hop',
  'semilleros-inicial-house',
  'funcional',
];

const FIRST_NAMES = [
  'Valentina', 'Santiago', 'Mariana', 'Samuel', 'Isabella', 'Matías', 'Sofía', 'Juan José', 'Gabriela',
  'Tomás', 'Daniela', 'Nicolás', 'Salomé', 'Emiliano', 'Luciana', 'Sebastián', 'Antonella', 'Jerónimo',
  'Manuela', 'David', 'Camila', 'Andrés', 'Paula', 'Felipe', 'Laura', 'Alejandro', 'Sara', 'Kevin',
  'Natalia', 'Brayan', 'Juliana', 'Esteban', 'Valeria', 'Cristian', 'Ana María', 'Miguel Ángel',
];
const LAST_NAMES = [
  'Rodríguez', 'Gómez', 'González', 'Martínez', 'García', 'López', 'Hernández', 'Sánchez', 'Ramírez',
  'Pérez', 'Díaz', 'Muñoz', 'Rojas', 'Moreno', 'Jiménez', 'Vargas', 'Castro', 'Ortiz', 'Torres', 'Suárez',
];
const STUDENT_COUNT = 36;
const MINORS = 6; // the last ones have a tarjeta de identidad

/** mulberry32: a tiny seeded generator, so every run gives the same academy. */
function random(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
  };
}

async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
}

interface Term {
  id: string;
  startsOn: string;
  endsOn: string;
}

export async function seedDemo(tx: Db, term: Term, directorId: string, now: Date) {
  const rnd = random(20262);
  const today = bogotaDate(now);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Catalog as the main seed left it.
  const [programs, tracks, courses, slots, links, sessions] = await Promise.all([
    tx.select().from(schema.program),
    tx.select().from(schema.track),
    tx.select().from(schema.course),
    tx.select().from(schema.courseSlot),
    tx.select().from(schema.trackCourse),
    tx.select().from(schema.session).where(eq(schema.session.termId, term.id)),
  ]);
  const coursesOfTrack = (trackId: string) => links.filter((l) => l.trackId === trackId).map((l) => l.courseId);
  const slotsOf = (courseId: string) =>
    slots.filter((s) => s.courseId === courseId).map((s) => ({ weekday: s.weekday, startsAt: s.startsAt, endsAt: s.endsAt }));
  const programOfCourse = new Map(courses.map((c) => [c.id, c.programId]));

  // The demo teacher, with an account, leading a few At My House clases.
  const [teacher] = await tx
    .insert(schema.person)
    .values({ ...DEMO_TEACHER, phone: '3001000001' })
    .returning();
  await tx.insert(schema.account).values({ personId: teacher!.id, passwordHash });
  await tx.insert(schema.roleGrant).values({ personId: teacher!.id, role: 'teacher' });
  const teacherCourses = courses.filter((c) => DEMO_TEACHER_COURSES.includes(c.slug)).map((c) => c.id);
  await tx.update(schema.course).set({ defaultTeacherId: teacher!.id }).where(inArray(schema.course.id, teacherCourses));
  await tx.update(schema.session).set({ teacherId: teacher!.id }).where(inArray(schema.session.courseId, teacherCourses));
  for (const s of sessions) if (teacherCourses.includes(s.courseId)) s.teacherId = teacher!.id;

  // Students: accounts with the demo password; they accept the terms on first login.
  const students: { id: string; fullName: string }[] = [];
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const minor = i >= STUDENT_COUNT - MINORS;
    const fullName = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${rnd.pick(LAST_NAMES)} ${rnd.pick(LAST_NAMES)}`;
    const [p] = await tx
      .insert(schema.person)
      .values({
        fullName,
        documentType: minor ? 'TI' : 'CC',
        documentNumber: String((minor ? 1100000100 : 1000000100) + i),
        phone: `3${rnd.int(10, 23)}${rnd.int(1000000, 9999999)}`,
      })
      .returning();
    await tx.insert(schema.account).values({ personId: p!.id, passwordHash });
    await tx.insert(schema.roleGrant).values({ personId: p!.id, role: 'student' });
    students.push({ id: p!.id, fullName });
  }

  // Inscripciones: one or two líneas or single clases each, never overlapping in time.
  const options = [
    ...tracks.map((t) => ({ trackId: t.id, courseId: null, courses: coursesOfTrack(t.id) })),
    ...courses.map((c) => ({ trackId: null, courseId: c.id, courses: [c.id] })),
  ];
  const enrollments: DatedEnrollment[] = [];
  const openRows: { id: string; studentId: string; schedule: ScheduledCourse[]; programId: string | null }[] = [];
  for (const [i, student] of students.entries()) {
    const wanted = rnd.chance(0.4) ? 2 : 1;
    const chosen: ScheduledCourse[] = [];
    for (let tries = 0; tries < 12 && enrollments.filter((e) => e.studentId === student.id).length < wanted; tries++) {
      // Most join a whole línea; some take a single clase.
      const option = rnd.chance(0.75) ? rnd.pick(options.filter((o) => o.trackId)) : rnd.pick(options.filter((o) => o.courseId));
      const lateJoin = rnd.chance(0.25);
      const validFrom = lateJoin ? addDays(term.startsOn, rnd.int(14, Math.max(14, daysBetween(term.startsOn, today) - 7))) : term.startsOn;
      const candidate = option.courses.map((courseId) => ({ courseId, slots: slotsOf(courseId), validFrom, validTo: term.endsOn }));
      if (option.courses.some((c) => chosen.some((x) => x.courseId === c))) continue;
      if (findOverlaps([...chosen, ...candidate]).length > 0) continue;
      chosen.push(...candidate);

      const [change] = await tx
        .insert(schema.enrollmentChange)
        .values({ studentId: student.id, effectiveOn: validFrom, reason: 'Inscripción (demo)', madeBy: directorId, madeAt: new Date(`${validFrom}T12:00:00Z`) })
        .returning();
      const [row] = await tx
        .insert(schema.enrollment)
        .values({ studentId: student.id, termId: term.id, trackId: option.trackId, courseId: option.courseId, validFrom, validTo: term.endsOn, openedByChange: change!.id })
        .returning();
      let validTo = term.endsOn;
      // A few students left mid-semestre: the inscripción is closed, never deleted.
      if (i % 12 === 5 && daysBetween(validFrom, today) > 40) {
        validTo = addDays(validFrom, rnd.int(20, daysBetween(validFrom, today) - 10));
        const [leave] = await tx
          .insert(schema.enrollmentChange)
          .values({ studentId: student.id, effectiveOn: addDays(validTo, 1), reason: 'Retiro (demo)', madeBy: directorId, madeAt: new Date(`${validTo}T12:00:00Z`) })
          .returning();
        await tx.update(schema.enrollment).set({ validTo, closedByChange: leave!.id }).where(eq(schema.enrollment.id, row!.id));
      }
      enrollments.push({ studentId: student.id, trackId: option.trackId, courseId: option.courseId, validFrom, validTo });
      if (validTo === term.endsOn) {
        const programId = option.trackId ? (tracks.find((t) => t.id === option.trackId)?.programId ?? null) : (programOfCourse.get(option.courseId!) ?? null);
        openRows.push({ id: row!.id, studentId: student.id, schedule: candidate, programId });
      }
    }
  }

  // History. Writing into locked sesiones needs the lock job's permission.
  await tx.execute(sql`select set_config('app.lock_job', 'on', true)`);
  const attendance: (typeof schema.attendance.$inferInsert)[] = [];
  const events: (typeof schema.attendanceEvent.$inferInsert)[] = [];
  const ledger: (typeof schema.makeupLedger.$inferInsert)[] = [];
  const notices: (typeof schema.absenceNotice.$inferInsert)[] = [];
  const lockedIds: string[] = [];

  function mark(s: (typeof sessions)[number], personId: string, state: AttendanceState, origin: 'enrolled' | 'makeup' | 'walk_in') {
    attendance.push({ sessionId: s.id, personId, state, origin, markedBy: s.teacherId, markedAt: s.endsAt });
    events.push({ sessionId: s.id, personId, oldState: null, newState: state, source: 'teacher', madeBy: s.teacherId, madeAt: s.endsAt });
    const programId = programOfCourse.get(s.courseId);
    if (!programId) return;
    for (const e of ledgerEffect(null, state)) {
      ledger.push({ personId, programId, delta: e.delta, reason: e.reason, sessionId: s.id, createdAt: s.startsAt });
    }
  }

  const ordered = [...sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let walkIns = 0;
  for (const s of ordered) {
    const date = bogotaDate(s.startsAt);
    const trackIds = links.filter((l) => l.courseId === s.courseId).map((l) => l.trackId);
    const enrolled = enrolledOn(enrollments, { id: s.courseId, trackIds }, date);

    if (isLocked(s.endsAt, now)) {
      // Past and closed: everyone has a state.
      for (const personId of enrolled) {
        const roll = rnd.next();
        const state: AttendanceState = roll < 0.8 ? 'present' : roll < 0.9 ? 'excused' : 'absent';
        if (state === 'excused' && rnd.chance(0.6)) {
          notices.push({ sessionId: s.id, personId, sentBy: personId, sentAt: new Date(s.startsAt.getTime() - rnd.int(26, 72) * 3600_000) });
        }
        mark(s, personId, state, 'enrolled');
      }
      // Now and then someone from another clase of the same programa comes as a makeup.
      const programId = programOfCourse.get(s.courseId);
      if (programId && rnd.chance(0.3)) {
        const sameProgram = enrollments.filter(
          (e) => !enrolled.includes(e.studentId) && (e.trackId ? tracks.find((t) => t.id === e.trackId)?.programId === programId : programOfCourse.get(e.courseId!) === programId),
        );
        if (sameProgram.length > 0) mark(s, rnd.pick(sameProgram).studentId, 'makeup', 'makeup');
      }
      // And a walk-in, some with a document so their history can join an account later.
      if (rnd.chance(0.12)) {
        walkIns++;
        const withDocument = rnd.chance(0.6);
        const [p] = await tx
          .insert(schema.person)
          .values({
            fullName: `${rnd.pick(FIRST_NAMES)} ${rnd.pick(LAST_NAMES)}`,
            phone: `3${rnd.int(10, 23)}${rnd.int(1000000, 9999999)}`,
            documentType: withDocument ? 'CC' : null,
            documentNumber: withDocument ? String(1090000000 + walkIns) : null,
          })
          .returning();
        mark(s, p!.id, 'present', 'walk_in');
      }
      lockedIds.push(s.id);
    } else if (s.startsAt > now && daysBetween(today, date) <= 7 && enrolled.length > 0 && rnd.chance(0.5)) {
      // Coming up this week: a student already sent an absence notice.
      const personId = rnd.pick(enrolled);
      notices.push({ sessionId: s.id, personId, sentBy: personId, sentAt: now });
      attendance.push({ sessionId: s.id, personId, state: 'excused', origin: 'enrolled', markedBy: personId, markedAt: now });
      events.push({ sessionId: s.id, personId, oldState: null, newState: 'excused', source: 'notice', madeBy: personId, madeAt: now });
      const programId = programOfCourse.get(s.courseId);
      if (programId) ledger.push({ personId, programId, delta: 1, reason: 'notice', sessionId: s.id, createdAt: now });
    }
    // Sesiones of today and the last 24 hours stay unmarked, ready to try.
  }

  await insertInChunks(attendance, (c) => tx.insert(schema.attendance).values(c));
  await insertInChunks(events, (c) => tx.insert(schema.attendanceEvent).values(c));
  await insertInChunks(ledger, (c) => tx.insert(schema.makeupLedger).values(c));
  await insertInChunks(notices, (c) => tx.insert(schema.absenceNotice).values(c));
  if (lockedIds.length > 0) {
    await tx
      .update(schema.session)
      .set({ lockedAt: sql`${schema.session.endsAt} + interval '24 hours'` })
      .where(inArray(schema.session.id, lockedIds));
  }

  const requests = await seedRequests();

  // A few requests waiting for a director: an inscripción, a salida and a reposición.
  async function seedRequests() {
    if (today < term.startsOn || addDays(today, 8) > term.endsOn) return 0;
    let count = 0;
    const [joiner, leaver, makeupTaker] = [students[0]!, students[1]!, students[2]!];

    const mine = openRows.filter((r) => r.studentId === joiner.id).flatMap((r) => r.schedule);
    const join = tracks.find((t) => {
      const candidate = coursesOfTrack(t.id).map((courseId) => ({ courseId, slots: slotsOf(courseId), validFrom: today, validTo: term.endsOn }));
      return candidate.every((c) => !mine.some((m) => m.courseId === c.courseId)) && findOverlaps([...mine, ...candidate]).length === 0;
    });
    if (join) {
      await tx.insert(schema.enrollmentRequest).values({ studentId: joiner.id, termId: term.id, action: 'join', trackId: join.id, wantedStart: addDays(today, 2), note: '¡Quiero probar esta línea!' });
      count++;
    }

    const leaving = openRows.find((r) => r.studentId === leaver.id);
    if (leaving) {
      await tx.insert(schema.enrollmentRequest).values({ studentId: leaver.id, termId: term.id, action: 'leave', replacesEnrollmentId: leaving.id, wantedStart: addDays(today, 7), note: 'Me cambiaron el horario del trabajo' });
      count++;
    }

    const own = openRows.filter((r) => r.studentId === makeupTaker.id);
    const ownCourses = own.flatMap((r) => r.schedule.map((c) => c.courseId));
    const programId = own.find((r) => r.programId)?.programId;
    const target = sessions
      .filter((x) => x.startsAt > now && daysBetween(today, bogotaDate(x.startsAt)) <= 10)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .find((x) => programOfCourse.get(x.courseId) === programId && !ownCourses.includes(x.courseId));
    if (programId && target) {
      await tx.insert(schema.makeupRequest).values({ studentId: makeupTaker.id, sessionId: target.id, programId, note: 'Para reponer la falta de la semana pasada' });
      count++;
    }
    return count;
  }

  return {
    requests,
    students: students.length,
    enrollments: enrollments.length,
    attendance: attendance.length,
    walkIns,
    programs: programs.length,
  };
}
