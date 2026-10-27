import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  inet,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Tables follow the design doc: nothing that matters is overwritten.
// Inscripciones are closed and reopened, attendance writes are logged,
// reposition balances are a ledger, and consents are append-only.

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// People

export const person = pgTable(
  'person',
  {
    id: id(),
    fullName: text('full_name').notNull(),
    documentType: text('document_type'),
    documentNumber: text('document_number'), // optional for walk-ins and guest teachers
    phone: text('phone').notNull(), // required as a contact number
    email: text('email'),
    mergedInto: uuid('merged_into').references((): AnyPgColumn => person.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('person_document_unique').on(t.documentType, t.documentNumber),
    check('person_document_type_check', sql`${t.documentType} in ('CC','TI','CE','PA')`),
  ],
);

/** Login is document number + password; a person without an account is a walk-in or guest. */
export const account = pgTable('account', {
  personId: uuid('person_id')
    .primaryKey()
    .references(() => person.id),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const program = pgTable('program', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  accentColor: text('accent_color'),
});

/** Directors are superadmins; program_id is the program a director leads. */
export const roleGrant = pgTable(
  'role_grant',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    role: text('role').notNull(),
    programId: uuid('program_id').references(() => program.id),
  },
  (t) => [
    unique('role_grant_unique').on(t.personId, t.role, t.programId).nullsNotDistinct(),
    check('role_grant_role_check', sql`${t.role} in ('student','teacher','director')`),
  ],
);

// Catalog

/** Línea */
export const track = pgTable('track', {
  id: id(),
  programId: uuid('program_id')
    .notNull()
    .references(() => program.id),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  level: text('level'),
  focus: text('focus'),
  active: boolean('active').notNull().default(true),
});

/** Clase: weekly (with slots) or special (dated sessions only); no program = general clase. */
export const course = pgTable(
  'course',
  {
    id: id(),
    programId: uuid('program_id').references(() => program.id),
    slug: text('slug').notNull().unique(),
    kind: text('kind').notNull().default('weekly'),
    title: text('title').notNull(),
    style: text('style'),
    description: text('description'),
    modality: text('modality').notNull().default('on_site'),
    onlineUrl: text('online_url'),
    room: text('room'),
    defaultTeacherId: uuid('default_teacher_id').references(() => person.id),
    // Optional: a weekly clase that runs for only part of the term (Intensivo: November).
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
  },
  (t) => [
    check('course_kind_check', sql`${t.kind} in ('weekly','special')`),
    check('course_modality_check', sql`${t.modality} in ('on_site','online')`),
  ],
);

export const courseSlot = pgTable(
  'course_slot',
  {
    id: id(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => course.id),
    weekday: smallint('weekday').notNull(), // 1 = Monday ... 7 = Sunday
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
  },
  (t) => [
    check('course_slot_weekday_check', sql`${t.weekday} between 1 and 7`),
    check('course_slot_time_check', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

export const trackCourse = pgTable(
  'track_course',
  {
    trackId: uuid('track_id')
      .notNull()
      .references(() => track.id),
    courseId: uuid('course_id')
      .notNull()
      .references(() => course.id),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.courseId] })],
);

// Calendar

/** Semestre: dates set by hand when the academy confirms it. */
export const term = pgTable('term', {
  id: id(),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
});

export const block = pgTable(
  'block',
  {
    id: id(),
    termId: uuid('term_id')
      .notNull()
      .references(() => term.id),
    number: smallint('number').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
  },
  (t) => [unique('block_term_number_unique').on(t.termId, t.number)],
);

export const session = pgTable(
  'session',
  {
    id: id(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => course.id),
    termId: uuid('term_id')
      .notNull()
      .references(() => term.id),
    blockId: uuid('block_id').references(() => block.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => person.id), // default teacher, substitute or guest
    modality: text('modality').notNull().default('on_site'),
    status: text('status').notNull().default('scheduled'),
    rescheduledTo: uuid('rescheduled_to').references((): AnyPgColumn => session.id),
    topic: text('topic'), // All Styles: style of the month
    // Attendance locks at ends_at + 24h (domain `locksAt`, enforced by a trigger).
  },
  (t) => [
    check('session_status_check', sql`${t.status} in ('scheduled','cancelled','rescheduled')`),
    check('session_modality_check', sql`${t.modality} in ('on_site','online')`),
    unique('session_course_start_unique').on(t.courseId, t.startsAt),
  ],
);

// Requests and enrollment

/** Inscripción: a student in a whole línea or a single clase, never edited in place. */
export const enrollment = pgTable(
  'enrollment',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => person.id),
    termId: uuid('term_id')
      .notNull()
      .references(() => term.id),
    trackId: uuid('track_id').references(() => track.id),
    courseId: uuid('course_id').references(() => course.id),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').notNull(), // at most the term's end
    openedByChange: uuid('opened_by_change')
      .notNull()
      .references((): AnyPgColumn => enrollmentChange.id),
    closedByChange: uuid('closed_by_change').references((): AnyPgColumn => enrollmentChange.id),
  },
  (t) => [
    check('enrollment_target_check', sql`(${t.trackId} is null) <> (${t.courseId} is null)`),
    check('enrollment_dates_check', sql`${t.validFrom} <= ${t.validTo}`),
  ],
);

/** Solicitud de cambio: the director may edit approved_start before approving. */
export const enrollmentRequest = pgTable(
  'enrollment_request',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => person.id),
    termId: uuid('term_id')
      .notNull()
      .references(() => term.id),
    action: text('action').notNull(),
    trackId: uuid('track_id').references(() => track.id),
    courseId: uuid('course_id').references(() => course.id),
    replacesEnrollmentId: uuid('replaces_enrollment_id').references(() => enrollment.id),
    wantedStart: date('wanted_start'),
    note: text('note'),
    status: text('status').notNull().default('pending'),
    approvedStart: date('approved_start'),
    reviewedBy: uuid('reviewed_by').references(() => person.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reply: text('reply'),
    createdAt: createdAt(),
  },
  (t) => [
    check('enrollment_request_action_check', sql`${t.action} in ('join','leave','swap')`),
    check(
      'enrollment_request_status_check',
      sql`${t.status} in ('pending','approved','denied','withdrawn')`,
    ),
  ],
);

export const enrollmentChange = pgTable('enrollment_change', {
  id: id(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => person.id),
  requestId: uuid('request_id').references(() => enrollmentRequest.id), // null when done directly
  effectiveOn: date('effective_on').notNull(),
  reason: text('reason'),
  madeBy: uuid('made_by')
    .notNull()
    .references(() => person.id),
  madeAt: timestamp('made_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Solicitud de reposición: the student asks, a director approves or denies. */
export const makeupRequest = pgTable(
  'makeup_request',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => person.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => program.id), // general clases: program of the last Falta con aviso
    note: text('note'),
    status: text('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => person.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reply: text('reply'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'makeup_request_status_check',
      sql`${t.status} in ('pending','approved','denied','withdrawn')`,
    ),
  ],
);

// Consent

export const legalDocument = pgTable(
  'legal_document',
  {
    id: id(),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    body: text('body').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    publishedBy: uuid('published_by').references(() => person.id),
  },
  (t) => [
    unique('legal_document_kind_version_unique').on(t.kind, t.version),
    check('legal_document_kind_check', sql`${t.kind} in ('terms','data_policy')`),
  ],
);

/** Append-only. Minors (TI) are accepted by a guardian. */
export const consent = pgTable(
  'consent',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    legalDocumentId: uuid('legal_document_id')
      .notNull()
      .references(() => legalDocument.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    guardianName: text('guardian_name'),
    guardianDocument: text('guardian_document'),
    guardianPhone: text('guardian_phone'),
  },
  (t) => [unique('consent_person_document_unique').on(t.personId, t.legalDocumentId)],
);

// Attendance

export const attendance = pgTable(
  'attendance',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    state: text('state').notNull(),
    origin: text('origin').notNull(),
    makeupRequestId: uuid('makeup_request_id').references(() => makeupRequest.id),
    markedBy: uuid('marked_by').references(() => person.id),
    markedAt: timestamp('marked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.personId] }),
    check('attendance_state_check', sql`${t.state} in ('present','absent','excused','makeup')`),
    check('attendance_origin_check', sql`${t.origin} in ('enrolled','makeup','walk_in')`),
  ],
);

export const attendanceEvent = pgTable('attendance_event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId: uuid('session_id').notNull(),
  personId: uuid('person_id').notNull(),
  oldState: text('old_state'),
  newState: text('new_state'),
  source: text('source').notNull(), // teacher, director, notice, cancellation, lock
  madeBy: uuid('made_by').references(() => person.id),
  madeAt: timestamp('made_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absenceNotice = pgTable('absence_notice', {
  id: id(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => session.id),
  personId: uuid('person_id')
    .notNull()
    .references(() => person.id),
  sentBy: uuid('sent_by').references(() => person.id),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  note: text('note'),
});

/** Balance = sum(delta) per person and program; it may be negative. */
export const makeupLedger = pgTable(
  'makeup_ledger',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => program.id),
    delta: smallint('delta').notNull(),
    reason: text('reason').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    expiresOn: date('expires_on'),
    createdAt: createdAt(),
  },
  (t) => [
    check('makeup_ledger_delta_check', sql`${t.delta} in (1,-1)`),
    check(
      'makeup_ledger_reason_check',
      sql`${t.reason} in ('notice','cancellation','makeup','reversal')`,
    ),
  ],
);
