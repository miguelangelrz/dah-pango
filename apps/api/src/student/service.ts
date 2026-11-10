import type { ProgramRef, StudentDay, StudentSession } from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  bogotaDate,
  isLocked,
  NOTICE_BEFORE_HOURS,
  noticeProblem,
  parseIsoDate,
  type AttendanceOrigin,
  type AttendanceState,
  type IsoDate,
} from '@dah-pango/domain';
import { and, asc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { loadSessions, rostersOf, type LoadedSession } from '../attendance/service';

// Reads behind Mis clases: a student's sesiones, grouped by day, and their programas.

const HOUR_MS = 60 * 60 * 1000;

type TermRow = typeof schema.term.$inferSelect;

/** The semestre running today, or else the next one, or else the last one. */
export async function currentTerm(db: Db, today: IsoDate): Promise<TermRow | null> {
  const terms = await db.select().from(schema.term).orderBy(asc(schema.term.startsOn));
  const day = parseIsoDate(today);
  return (
    terms.find((t) => parseIsoDate(t.startsOn) <= day && day <= parseIsoDate(t.endsOn)) ??
    terms.find((t) => parseIsoDate(t.startsOn) > day) ??
    terms.at(-1) ??
    null
  );
}

export async function programsById(db: Db): Promise<Map<string, ProgramRef>> {
  const rows = await db.select().from(schema.program);
  return new Map(rows.map((p) => [p.id, { id: p.id, name: p.name, accentColor: p.accentColor }]));
}

/** Programas of a student's inscripciones in a semestre that are still running on `from`. */
export async function enrolledProgramIds(db: Db, personId: string, termId: string, from: IsoDate): Promise<string[]> {
  const rows = await db
    .select({ track: schema.track.programId, course: schema.course.programId })
    .from(schema.enrollment)
    .leftJoin(schema.track, eq(schema.track.id, schema.enrollment.trackId))
    .leftJoin(schema.course, eq(schema.course.id, schema.enrollment.courseId))
    .where(
      and(
        eq(schema.enrollment.studentId, personId),
        eq(schema.enrollment.termId, termId),
        gte(schema.enrollment.validTo, from),
      ),
    );
  return [...new Set(rows.map((r) => r.track ?? r.course).filter((p): p is string => p !== null))];
}

/**
 * The sesiones a student is on the list of between two instants: their clases on the days
 * they were enrolled, plus any sesión where they have a mark (a makeup, for example).
 */
export async function studentSessions(db: Db, personId: string, from: Date, to: Date, now: Date): Promise<StudentSession[]> {
  const enrollments = await db.select().from(schema.enrollment).where(eq(schema.enrollment.studentId, personId));
  const trackIds = enrollments.map((e) => e.trackId).filter((t): t is string => Boolean(t));
  const [links, marked] = await Promise.all([
    trackIds.length ? db.select().from(schema.trackCourse).where(inArray(schema.trackCourse.trackId, trackIds)) : [],
    db.select({ id: schema.attendance.sessionId }).from(schema.attendance).where(eq(schema.attendance.personId, personId)),
  ]);
  const courseIds = [
    ...new Set([...enrollments.map((e) => e.courseId).filter((c): c is string => Boolean(c)), ...links.map((l) => l.courseId)]),
  ];
  const sessionIds = marked.map((m) => m.id);
  if (courseIds.length === 0 && sessionIds.length === 0) return [];

  const loaded = await loadSessions(
    db,
    and(
      gte(schema.session.startsAt, from),
      lt(schema.session.startsAt, to),
      or(
        courseIds.length ? inArray(schema.session.courseId, courseIds) : undefined,
        sessionIds.length ? inArray(schema.session.id, sessionIds) : undefined,
      ),
    ),
  );
  if (loaded.length === 0) return [];
  const [rosters, notices] = await Promise.all([
    rostersOf(db, loaded.map((l) => l.session)),
    db
      .select({ sessionId: schema.absenceNotice.sessionId })
      .from(schema.absenceNotice)
      .where(
        and(
          eq(schema.absenceNotice.personId, personId),
          inArray(schema.absenceNotice.sessionId, loaded.map((l) => l.session.id)),
        ),
      ),
  ]);

  const out: StudentSession[] = [];
  for (const l of loaded) {
    const row = rosters.get(l.session.id)?.find((r) => r.personId === personId);
    if (!row) continue;
    out.push(studentSessionView(l, row, notices.some((n) => n.sessionId === l.session.id), now));
  }
  return out;
}

export function studentSessionView(
  l: LoadedSession,
  row: { origin: AttendanceOrigin; state: AttendanceState | null },
  noticeSent: boolean,
  now: Date,
): StudentSession {
  const { session, course, program, teacher } = l;
  const status = session.status as StudentSession['status'];
  return {
    id: session.id,
    course: { id: course.id, title: course.title, style: course.style },
    program,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    status,
    modality: session.modality as StudentSession['modality'],
    room: course.room,
    teacherName: teacher.fullName,
    origin: row.origin,
    state: row.state,
    noticeSent,
    noticeUntil: new Date(session.startsAt.getTime() - NOTICE_BEFORE_HOURS * HOUR_MS).toISOString(),
    canNotify: noticeProblem({ startsAt: session.startsAt, endsAt: session.endsAt, status }, row, now) === null,
    locked: isLocked(session.endsAt, now),
  };
}

/** Sesiones grouped by Bogotá day, in order. */
export function byDay(sessions: StudentSession[]): StudentDay[] {
  const days: StudentDay[] = [];
  for (const s of sessions) {
    const date = bogotaDate(new Date(s.startsAt));
    const last = days.at(-1);
    if (last?.date === date) last.sessions.push(s);
    else days.push({ date, sessions: [s] });
  }
  return days;
}
