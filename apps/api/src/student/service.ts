import type {
  CourseOption,
  EnrollmentRequestView,
  MakeupRequestView,
  ProgramRef,
  RequestView,
  StudentEnrollment,
  StudentSession,
  TrackOption,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  clashesWith,
  isLocked,
  NOTICE_BEFORE_HOURS,
  noticeProblem,
  parseIsoDate,
  type AttendanceState,
  type EnrollmentAction,
  type IsoDate,
  type RequestStatus,
  type ScheduledCourse,
} from '@dah-pango/domain';
import { and, asc, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { balancesOf, documentOf, loadSessions, rostersOf, type LoadedSession } from '../attendance/service';

// Reads behind the student screens and the request review: a student's inscripciones,
// sesiones and balances, and requests shown the same way to students and directors.

const HOUR_MS = 60 * 60 * 1000;

type TermRow = typeof schema.term.$inferSelect;
type EnrollmentRow = typeof schema.enrollment.$inferSelect;

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

export const termView = (t: TermRow) => ({ id: t.id, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn });

async function programsById(db: Db): Promise<Map<string, ProgramRef>> {
  const rows = await db.select().from(schema.program);
  return new Map(rows.map((p) => [p.id, { id: p.id, name: p.name, accentColor: p.accentColor }]));
}

/** Every clase and línea with its weekly slots, for showing and for overlap checks. */
export async function catalog(db: Db) {
  const [programs, tracks, courses, slots, links] = await Promise.all([
    programsById(db),
    db.select().from(schema.track).orderBy(asc(schema.track.name)),
    db.select().from(schema.course).orderBy(asc(schema.course.title)),
    db.select().from(schema.courseSlot).orderBy(asc(schema.courseSlot.weekday), asc(schema.courseSlot.startsAt)),
    db.select().from(schema.trackCourse),
  ]);
  const hhmm = (t: string) => t.slice(0, 5);
  const courseOption = (c: (typeof courses)[number]): CourseOption => ({
    id: c.id,
    title: c.title,
    program: c.programId ? (programs.get(c.programId) ?? null) : null,
    slots: slots
      .filter((s) => s.courseId === c.id)
      .map((s) => ({ weekday: s.weekday, startsAt: hhmm(s.startsAt), endsAt: hhmm(s.endsAt) })),
  });
  const courseOptions = new Map(courses.map((c) => [c.id, courseOption(c)]));
  const trackOptions = new Map<string, TrackOption>(
    tracks.map((t) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        program: programs.get(t.programId)!,
        courses: links
          .filter((l) => l.trackId === t.id)
          .map((l) => courseOptions.get(l.courseId)!)
          .sort((a, b) => a.title.localeCompare(b.title, 'es')),
      },
    ]),
  );
  return { programs, tracks, courses, courseOptions, trackOptions };
}

export type Catalog = Awaited<ReturnType<typeof catalog>>;

/** The clases an inscripción covers, as dated windows for `findOverlaps`. */
export function scheduleOf(
  cat: Catalog,
  target: { trackId: string | null; courseId: string | null },
  window: { validFrom: IsoDate; validTo: IsoDate },
): ScheduledCourse[] {
  const courses = target.trackId
    ? (cat.trackOptions.get(target.trackId)?.courses ?? [])
    : [cat.courseOptions.get(target.courseId!)].filter((c): c is CourseOption => Boolean(c));
  return courses.map((c) => {
    const row = cat.courses.find((x) => x.id === c.id);
    // A clase that runs for part of the semestre only overlaps within its own dates.
    const from = row?.startsOn && row.startsOn > window.validFrom ? row.startsOn : window.validFrom;
    const to = row?.endsOn && row.endsOn < window.validTo ? row.endsOn : window.validTo;
    return { courseId: c.id, slots: c.slots, validFrom: from, validTo: to < from ? from : to };
  });
}

/** Titles of the student's clases that `candidate` would overlap. */
export function clashTitles(
  cat: Catalog,
  existing: EnrollmentRow[],
  candidate: ScheduledCourse[],
): string[] {
  const mine = existing.flatMap((e) => scheduleOf(cat, e, e));
  return clashesWith(mine, candidate).map((id) => cat.courseOptions.get(id)?.title ?? '');
}

/** A student's inscripciones in a semestre that are still open or end on or after `from`. */
export async function enrollmentsOf(db: Db, personId: string, termId: string, from?: IsoDate) {
  return db
    .select()
    .from(schema.enrollment)
    .where(
      and(
        eq(schema.enrollment.studentId, personId),
        eq(schema.enrollment.termId, termId),
        from ? gte(schema.enrollment.validTo, from) : undefined,
      ),
    )
    .orderBy(asc(schema.enrollment.validFrom));
}

export function enrollmentView(cat: Catalog, e: EnrollmentRow): StudentEnrollment {
  const track = e.trackId ? cat.trackOptions.get(e.trackId) : undefined;
  const course = e.courseId ? cat.courseOptions.get(e.courseId) : undefined;
  return {
    id: e.id,
    target: track
      ? { kind: 'track', id: track.id, name: track.name }
      : { kind: 'course', id: course?.id ?? '', name: course?.title ?? '' },
    program: track?.program ?? course?.program ?? null,
    validFrom: e.validFrom,
    validTo: e.validTo,
    courses: track ? track.courses : course ? [course] : [],
  };
}

/** Programas the student is in through these inscripciones. */
export function programIdsOf(cat: Catalog, enrollments: EnrollmentRow[]): string[] {
  return [
    ...new Set(
      enrollments
        .map((e) =>
          e.trackId
            ? cat.trackOptions.get(e.trackId)?.program.id
            : cat.courses.find((c) => c.id === e.courseId)?.programId,
        )
        .filter((p): p is string => Boolean(p)),
    ),
  ];
}

/**
 * The sesiones a student is on the list of between two instants: their clases on the days
 * they were enrolled, approved reposiciones, and any sesión where they have a mark.
 */
export async function studentSessions(db: Db, personId: string, from: Date, to: Date, now: Date): Promise<StudentSession[]> {
  const enrollments = await db.select().from(schema.enrollment).where(eq(schema.enrollment.studentId, personId));
  const trackIds = enrollments.map((e) => e.trackId).filter((t): t is string => Boolean(t));
  const [links, marked, makeups] = await Promise.all([
    trackIds.length ? db.select().from(schema.trackCourse).where(inArray(schema.trackCourse.trackId, trackIds)) : [],
    db.select({ id: schema.attendance.sessionId }).from(schema.attendance).where(eq(schema.attendance.personId, personId)),
    db
      .select({ id: schema.makeupRequest.sessionId })
      .from(schema.makeupRequest)
      .where(and(eq(schema.makeupRequest.studentId, personId), eq(schema.makeupRequest.status, 'approved'))),
  ]);
  const courseIds = [
    ...new Set([
      ...enrollments.map((e) => e.courseId).filter((c): c is string => Boolean(c)),
      ...links.map((l) => l.courseId),
    ]),
  ];
  const sessionIds = [...new Set([...marked, ...makeups].map((r) => r.id))];
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
  const rosters = await rostersOf(db, loaded.map((l) => l.session));
  const notices = loaded.length
    ? await db
        .select({ sessionId: schema.absenceNotice.sessionId })
        .from(schema.absenceNotice)
        .where(
          and(
            eq(schema.absenceNotice.personId, personId),
            inArray(schema.absenceNotice.sessionId, loaded.map((l) => l.session.id)),
          ),
        )
    : [];

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
  row: { origin: StudentSession['origin']; state: AttendanceState | null },
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

/** Requests as both the student and the directors see them, newest first. */
export async function requestViews(
  db: Db,
  filter: { studentId?: string; status?: RequestStatus },
  today: IsoDate,
  limit = 100,
): Promise<RequestView[]> {
  const enrollmentWhere = and(
    filter.studentId ? eq(schema.enrollmentRequest.studentId, filter.studentId) : undefined,
    filter.status ? eq(schema.enrollmentRequest.status, filter.status) : undefined,
  );
  const makeupWhere = and(
    filter.studentId ? eq(schema.makeupRequest.studentId, filter.studentId) : undefined,
    filter.status ? eq(schema.makeupRequest.status, filter.status) : undefined,
  );
  const [enrollmentRequests, makeupRequests, cat, terms] = await Promise.all([
    db.select().from(schema.enrollmentRequest).where(enrollmentWhere).orderBy(desc(schema.enrollmentRequest.createdAt)).limit(limit),
    db.select().from(schema.makeupRequest).where(makeupWhere).orderBy(desc(schema.makeupRequest.createdAt)).limit(limit),
    catalog(db),
    db.select().from(schema.term),
  ]);

  const personIds = [
    ...new Set(
      [...enrollmentRequests, ...makeupRequests].flatMap((r) => [r.studentId, r.reviewedBy].filter((x): x is string => Boolean(x))),
    ),
  ];
  const replacedIds = enrollmentRequests.map((r) => r.replacesEnrollmentId).filter((x): x is string => Boolean(x));
  const [people, replaced, sessions, balances] = await Promise.all([
    personIds.length ? db.select().from(schema.person).where(inArray(schema.person.id, personIds)) : [],
    replacedIds.length ? db.select().from(schema.enrollment).where(inArray(schema.enrollment.id, replacedIds)) : [],
    makeupRequests.length ? loadSessions(db, inArray(schema.session.id, makeupRequests.map((r) => r.sessionId))) : [],
    balancesOf(db, [...new Set(makeupRequests.map((r) => r.studentId))]),
  ]);
  const personRef = (id: string) => {
    const p = people.find((x) => x.id === id);
    return { id, fullName: p?.fullName ?? '', document: p ? documentOf(p) : null };
  };
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.fullName ?? null) : null);

  // Clashes only matter while a request waits: look at each student's current clases.
  const pendingStudents = [...new Set(enrollmentRequests.filter((r) => r.status === 'pending').map((r) => r.studentId))];
  const open = pendingStudents.length
    ? await db
        .select()
        .from(schema.enrollment)
        .where(and(inArray(schema.enrollment.studentId, pendingStudents), gte(schema.enrollment.validTo, today)))
    : [];

  const enrollmentViews: EnrollmentRequestView[] = enrollmentRequests.map((r) => {
    const track = r.trackId ? cat.trackOptions.get(r.trackId) : undefined;
    const course = r.courseId ? cat.courseOptions.get(r.courseId) : undefined;
    const old = replaced.find((e) => e.id === r.replacesEnrollmentId);
    let clashes: string[] = [];
    if (r.status === 'pending' && (r.trackId || r.courseId)) {
      const start = r.wantedStart ?? today;
      const termEnd = terms.find((t) => t.id === r.termId)?.endsOn ?? start;
      const others = open.filter((e) => e.studentId === r.studentId && e.termId === r.termId && e.id !== r.replacesEnrollmentId);
      const candidate = scheduleOf(cat, r, { validFrom: start, validTo: termEnd });
      clashes = clashTitles(cat, others, candidate);
    }
    return {
      kind: 'enrollment',
      id: r.id,
      status: r.status as RequestStatus,
      action: r.action as EnrollmentAction,
      student: personRef(r.studentId),
      target: track
        ? { kind: 'track', id: track.id, name: track.name, program: track.program }
        : course
          ? { kind: 'course', id: course.id, name: course.title, program: course.program }
          : null,
      replaces: old ? { id: old.id, name: enrollmentView(cat, old).target.name, validFrom: old.validFrom, validTo: old.validTo } : null,
      wantedStart: r.wantedStart,
      approvedStart: r.approvedStart,
      note: r.note,
      reply: r.reply,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedBy: nameOf(r.reviewedBy),
      clashes,
    };
  });

  const makeupViews: MakeupRequestView[] = makeupRequests.map((r) => {
    const l = sessions.find((s) => s.session.id === r.sessionId)!;
    return {
      kind: 'makeup',
      id: r.id,
      status: r.status as RequestStatus,
      student: personRef(r.studentId),
      session: {
        id: l.session.id,
        title: l.course.title,
        startsAt: l.session.startsAt.toISOString(),
        endsAt: l.session.endsAt.toISOString(),
        program: l.program,
      },
      program: cat.programs.get(r.programId)!,
      balance: balances.get(r.studentId)?.get(r.programId) ?? 0,
      note: r.note,
      reply: r.reply,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedBy: nameOf(r.reviewedBy),
    };
  });

  return [...enrollmentViews, ...makeupViews]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
