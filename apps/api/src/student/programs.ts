import type {
  ClassSlot,
  CourseOption,
  EnrolledCourse as EnrolledCourseView,
  StudentCourse,
  StudentEnrollmentRequest,
  StudentProgram,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  clashesWith,
  earliestLeaveOn,
  parseIsoDate,
  type EnrollmentAction,
  type IsoDate,
  type RequestStatus,
  type ScheduledCourse,
} from '@dah-pango/domain';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { Problem } from '../admin/calendar';
import { programsById } from './service';

// Reads and checks behind Mis programas: the weekly clases a student is in, grouped by
// programa (líneas stay internal), the clases they could add, and their requests.

type TermRow = typeof schema.term.$inferSelect;
type CourseRow = typeof schema.course.$inferSelect;
type EnrollmentRow = typeof schema.enrollment.$inferSelect;
type RequestRow = typeof schema.enrollmentRequest.$inferSelect;

/** Weekly clases with their slots, líneas and teachers. */
export async function loadCourses(db: Db) {
  const [courses, slots, links, tracks] = await Promise.all([
    db.select().from(schema.course).where(eq(schema.course.kind, 'weekly')).orderBy(asc(schema.course.title)),
    db.select().from(schema.courseSlot).orderBy(asc(schema.courseSlot.weekday), asc(schema.courseSlot.startsAt)),
    db.select().from(schema.trackCourse),
    db.select({ id: schema.track.id, programId: schema.track.programId }).from(schema.track),
  ]);
  const teacherIds = [...new Set(courses.map((c) => c.defaultTeacherId).filter((id): id is string => id !== null))];
  const teachers = teacherIds.length
    ? await db
        .select({ id: schema.person.id, fullName: schema.person.fullName })
        .from(schema.person)
        .where(inArray(schema.person.id, teacherIds))
    : [];
  const hhmm = (t: string) => t.slice(0, 5);
  const slotsOf = new Map<string, ClassSlot[]>();
  for (const s of slots) {
    const list = slotsOf.get(s.courseId) ?? [];
    list.push({ weekday: s.weekday, startsAt: hhmm(s.startsAt), endsAt: hhmm(s.endsAt) });
    slotsOf.set(s.courseId, list);
  }
  const teacherName = new Map(teachers.map((t) => [t.id, t.fullName]));
  return {
    courses: new Map(courses.map((c) => [c.id, c])),
    slotsOf,
    teacherName,
    trackProgram: new Map(tracks.map((t) => [t.id, t.programId])),
    coursesOfTrack: (trackId: string) => links.filter((l) => l.trackId === trackId).map((l) => l.courseId),
  };
}

export type LoadedCourses = Awaited<ReturnType<typeof loadCourses>>;

export function studentCourseView(loaded: LoadedCourses, course: CourseRow): StudentCourse {
  return {
    id: course.id,
    title: course.title,
    style: course.style,
    slots: loaded.slotsOf.get(course.id) ?? [],
    teacherName: course.defaultTeacherId ? (loaded.teacherName.get(course.defaultTeacherId) ?? null) : null,
    modality: course.modality as StudentCourse['modality'],
    room: course.room,
  };
}

/** A clase the student is in, through which inscripción, and the programa it counts in. */
export interface EnrolledCourse {
  course: CourseRow;
  enrollment: EnrollmentRow;
  programId: string | null;
}

/**
 * The weekly clases a student is in from `today` until the end of the semestre. A clase
 * reached through a línea counts in that línea's programa. Each clase appears once.
 */
export async function enrolledCourses(
  db: Db,
  loaded: LoadedCourses,
  studentId: string,
  termId: string,
  today: IsoDate,
): Promise<EnrolledCourse[]> {
  const enrollments = await db
    .select()
    .from(schema.enrollment)
    .where(and(eq(schema.enrollment.studentId, studentId), eq(schema.enrollment.termId, termId)))
    .orderBy(asc(schema.enrollment.validFrom));
  const day = parseIsoDate(today);
  const out: EnrolledCourse[] = [];
  for (const e of enrollments) {
    // Ended, or closed before it started.
    if (parseIsoDate(e.validTo) < day || parseIsoDate(e.validTo) < parseIsoDate(e.validFrom)) continue;
    const courseIds = e.trackId ? loaded.coursesOfTrack(e.trackId) : [e.courseId!];
    for (const id of courseIds) {
      const course = loaded.courses.get(id);
      if (!course || out.some((x) => x.course.id === id)) continue;
      if (course.endsOn && parseIsoDate(course.endsOn) < day) continue;
      const programId = e.trackId ? (loaded.trackProgram.get(e.trackId) ?? null) : course.programId;
      out.push({ course, enrollment: e, programId });
    }
  }
  return out;
}

/** A clase's weekly slots between two days, cut to the clase's own dates, for overlap checks. */
function scheduled(loaded: LoadedCourses, course: CourseRow, from: IsoDate, to: IsoDate): ScheduledCourse {
  const validFrom = course.startsOn && course.startsOn > from ? course.startsOn : from;
  const validTo = course.endsOn && course.endsOn < to ? course.endsOn : to;
  return { courseId: course.id, slots: loaded.slotsOf.get(course.id) ?? [], validFrom, validTo };
}

/** Titles of the student's clases (other than `except`) that `course` would overlap from today on. */
export function clashTitles(
  loaded: LoadedCourses,
  mine: EnrolledCourse[],
  course: CourseRow,
  window: { today: IsoDate; endsOn: IsoDate },
  except?: string,
): string[] {
  const later = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
  const existing = mine
    .filter((m) => m.course.id !== except)
    .map((m) => scheduled(loaded, m.course, later(m.enrollment.validFrom, window.today), m.enrollment.validTo));
  const ids = clashesWith(existing, scheduled(loaded, course, window.today, window.endsOn));
  return ids.map((id) => loaded.courses.get(id)?.title ?? '');
}

const byFirstSlot = (loaded: LoadedCourses) => (a: CourseRow, b: CourseRow) => {
  const sa = loaded.slotsOf.get(a.id)?.[0];
  const sb = loaded.slotsOf.get(b.id)?.[0];
  const key = (s: ClassSlot | undefined) => (s ? `${s.weekday}${s.startsAt}` : '9');
  return key(sa).localeCompare(key(sb)) || a.title.localeCompare(b.title, 'es');
};

/**
 * The programas (by name) the student has clases in, then general clases if they have any.
 * `startedToday` holds the clases whose sesión already started today.
 */
export async function studentPrograms(
  db: Db,
  loaded: LoadedCourses,
  mine: EnrolledCourse[],
  today: IsoDate,
  startedToday: Set<string>,
): Promise<StudentProgram[]> {
  const programs = [...(await programsById(db)).values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const coursesIn = (programId: string | null): EnrolledCourseView[] =>
    mine
      .filter((m) => m.programId === programId)
      .sort((a, b) => byFirstSlot(loaded)(a.course, b.course))
      .map((m) => ({
        ...studentCourseView(loaded, m.course),
        leaveFrom: earliestLeaveOn(today, startedToday.has(m.course.id)),
        enrolledUntil: m.enrollment.validTo,
      }));
  return [
    ...programs.map((program) => ({ program, courses: coursesIn(program.id) })),
    { program: null, courses: coursesIn(null) },
  ].filter((p) => p.courses.length > 0);
}

/**
 * The weekly clases of a programa (null: general clases) the student isn't in yet and that
 * still run, with what each would overlap. When changing a clase, that one doesn't count.
 */
export function courseOptions(
  loaded: LoadedCourses,
  mine: EnrolledCourse[],
  pending: RequestRow[],
  programId: string | null,
  window: { today: IsoDate; endsOn: IsoDate },
  replacesCourseId?: string,
): CourseOption[] {
  const taken = new Set(mine.map((m) => m.course.id));
  const requested = new Set(pending.filter((r) => r.action !== 'leave').map((r) => r.courseId));
  return [...loaded.courses.values()]
    .filter((c) => c.programId === programId && !taken.has(c.id))
    .filter((c) => !c.endsOn || parseIsoDate(c.endsOn) >= parseIsoDate(window.today))
    .filter((c) => (loaded.slotsOf.get(c.id) ?? []).length > 0)
    .sort(byFirstSlot(loaded))
    .map((c) => ({
      ...studentCourseView(loaded, c),
      clashesWith: clashTitles(loaded, mine, c, window, replacesCourseId),
      requested: requested.has(c.id),
    }));
}

/** A student's pending requests in a semestre. */
export async function pendingRequests(db: Db, studentId: string, termId: string): Promise<RequestRow[]> {
  return db
    .select()
    .from(schema.enrollmentRequest)
    .where(
      and(
        eq(schema.enrollmentRequest.studentId, studentId),
        eq(schema.enrollmentRequest.termId, termId),
        eq(schema.enrollmentRequest.status, 'pending'),
      ),
    );
}

/** The programa a request belongs to: the one of the clase it adds or replaces. */
export function requestProgramId(loaded: LoadedCourses, mine: EnrolledCourse[], r: RequestRow): string | null {
  const replaced = r.replacesCourseId ? mine.find((m) => m.course.id === r.replacesCourseId) : undefined;
  if (replaced) return replaced.programId;
  const id = r.courseId ?? r.replacesCourseId;
  return id ? (loaded.courses.get(id)?.programId ?? null) : null;
}

export async function requestsOf(
  db: Db,
  loaded: LoadedCourses,
  mine: EnrolledCourse[],
  studentId: string,
  termId: string,
): Promise<StudentEnrollmentRequest[]> {
  const rows = await db
    .select()
    .from(schema.enrollmentRequest)
    .where(and(eq(schema.enrollmentRequest.studentId, studentId), eq(schema.enrollmentRequest.termId, termId)))
    .orderBy(desc(schema.enrollmentRequest.createdAt));
  const ref = (id: string | null) => {
    const c = id ? loaded.courses.get(id) : undefined;
    return c ? { id: c.id, title: c.title } : null;
  };
  return rows.map((r) => ({
    id: r.id,
    action: r.action as EnrollmentAction,
    status: r.status as RequestStatus,
    programId: requestProgramId(loaded, mine, r),
    course: ref(r.courseId),
    replacesCourse: ref(r.replacesCourseId),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** What a student's new request is checked against. */
export interface RequestContext {
  loaded: LoadedCourses;
  mine: EnrolledCourse[];
  pending: RequestRow[];
  term: TermRow;
  today: IsoDate;
}

/** The clase the student is in, or a 404 Problem. */
function enrolledIn(ctx: RequestContext, courseId: string): EnrolledCourse {
  const found = ctx.mine.find((m) => m.course.id === courseId);
  if (!found) throw new Problem(404, 'No estás inscrito en esa clase');
  if (ctx.pending.some((r) => r.replacesCourseId === courseId)) {
    throw new Problem(409, 'Ya tienes una solicitud pendiente para esa clase');
  }
  return found;
}

/** A clase the student can be added to (in `programId`), or a Problem saying why not. */
function addable(ctx: RequestContext, courseId: string, programId: string | null, except?: string): CourseRow {
  const course = ctx.loaded.courses.get(courseId);
  if (!course || (course.endsOn && parseIsoDate(course.endsOn) < parseIsoDate(ctx.today))) {
    throw new Problem(404, 'No encontramos esa clase');
  }
  if (course.programId !== programId) throw new Problem(409, 'Esa clase es de otro programa');
  if (ctx.mine.some((m) => m.course.id === courseId)) throw new Problem(409, 'Ya estás inscrito en esa clase');
  if (ctx.pending.some((r) => r.action !== 'leave' && r.courseId === courseId)) {
    throw new Problem(409, 'Ya pediste esa clase');
  }
  const clashes = clashTitles(ctx.loaded, ctx.mine, course, { today: ctx.today, endsOn: ctx.term.endsOn }, except);
  if (clashes.length > 0) throw new Problem(409, `Se cruza en horario con ${clashes.join(', ')}`);
  return course;
}

/** The clases a checked request points at, as enrollment_request stores them. */
export interface RequestTarget {
  courseId: string | null;
  replacesEnrollmentId: string | null;
  replacesCourseId: string | null;
}

/** Checks a request to join a clase; general clases have programId null. */
export function checkJoin(ctx: RequestContext, courseId: string): RequestTarget {
  const course = ctx.loaded.courses.get(courseId);
  addable(ctx, courseId, course?.programId ?? null);
  return { courseId, replacesEnrollmentId: null, replacesCourseId: null };
}

/** Checks a request to change one clase for another in the same programa. */
export function checkSwap(ctx: RequestContext, replacesCourseId: string, courseId: string): RequestTarget {
  const current = enrolledIn(ctx, replacesCourseId);
  addable(ctx, courseId, current.programId, replacesCourseId);
  return { courseId, replacesEnrollmentId: current.enrollment.id, replacesCourseId };
}

/** The clases among `courseIds` with a sesión that started between `dayStart` and `now`. */
export async function startedToday(db: Db, courseIds: string[], dayStart: Date, now: Date): Promise<Set<string>> {
  if (courseIds.length === 0) return new Set();
  const rows = await db
    .select({ courseId: schema.session.courseId })
    .from(schema.session)
    .where(
      and(
        inArray(schema.session.courseId, courseIds),
        eq(schema.session.status, 'scheduled'),
        gte(schema.session.startsAt, dayStart),
        lte(schema.session.startsAt, now),
      ),
    );
  return new Set(rows.map((r) => r.courseId));
}
