CREATE TABLE "absence_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "account" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"state" text NOT NULL,
	"origin" text NOT NULL,
	"makeup_request_id" uuid,
	"marked_by" uuid,
	"marked_at" timestamp with time zone,
	CONSTRAINT "attendance_session_id_person_id_pk" PRIMARY KEY("session_id","person_id"),
	CONSTRAINT "attendance_state_check" CHECK ("attendance"."state" in ('present','absent','excused','makeup')),
	CONSTRAINT "attendance_origin_check" CHECK ("attendance"."origin" in ('enrolled','makeup','walk_in'))
);
--> statement-breakpoint
CREATE TABLE "attendance_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"old_state" text,
	"new_state" text,
	"source" text NOT NULL,
	"made_by" uuid,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	CONSTRAINT "block_term_number_unique" UNIQUE("term_id","number")
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"guardian_name" text,
	"guardian_document" text,
	"guardian_phone" text,
	CONSTRAINT "consent_person_document_unique" UNIQUE("person_id","legal_document_id")
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'weekly' NOT NULL,
	"title" text NOT NULL,
	"style" text,
	"description" text,
	"modality" text DEFAULT 'on_site' NOT NULL,
	"online_url" text,
	"room" text,
	"default_teacher_id" uuid,
	"starts_on" date,
	"ends_on" date,
	CONSTRAINT "course_slug_unique" UNIQUE("slug"),
	CONSTRAINT "course_kind_check" CHECK ("course"."kind" in ('weekly','special')),
	CONSTRAINT "course_modality_check" CHECK ("course"."modality" in ('on_site','online'))
);
--> statement-breakpoint
CREATE TABLE "course_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	CONSTRAINT "course_slot_weekday_check" CHECK ("course_slot"."weekday" between 1 and 7),
	CONSTRAINT "course_slot_time_check" CHECK ("course_slot"."starts_at" < "course_slot"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"track_id" uuid,
	"course_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"opened_by_change" uuid NOT NULL,
	"closed_by_change" uuid,
	CONSTRAINT "enrollment_target_check" CHECK (("enrollment"."track_id" is null) <> ("enrollment"."course_id" is null)),
	CONSTRAINT "enrollment_dates_check" CHECK ("enrollment"."valid_from" <= "enrollment"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "enrollment_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"request_id" uuid,
	"effective_on" date NOT NULL,
	"reason" text,
	"made_by" uuid NOT NULL,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"action" text NOT NULL,
	"track_id" uuid,
	"course_id" uuid,
	"replaces_enrollment_id" uuid,
	"wanted_start" date,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_start" date,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_request_action_check" CHECK ("enrollment_request"."action" in ('join','leave','swap')),
	CONSTRAINT "enrollment_request_status_check" CHECK ("enrollment_request"."status" in ('pending','approved','denied','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "legal_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" uuid,
	CONSTRAINT "legal_document_kind_version_unique" UNIQUE("kind","version"),
	CONSTRAINT "legal_document_kind_check" CHECK ("legal_document"."kind" in ('terms','data_policy'))
);
--> statement-breakpoint
CREATE TABLE "makeup_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"delta" smallint NOT NULL,
	"reason" text NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "makeup_ledger_delta_check" CHECK ("makeup_ledger"."delta" in (1,-1)),
	CONSTRAINT "makeup_ledger_reason_check" CHECK ("makeup_ledger"."reason" in ('notice','cancellation','makeup','reversal'))
);
--> statement-breakpoint
CREATE TABLE "makeup_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "makeup_request_status_check" CHECK ("makeup_request"."status" in ('pending','approved','denied','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"document_type" text,
	"document_number" text,
	"phone" text NOT NULL,
	"email" text,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_document_unique" UNIQUE("document_type","document_number"),
	CONSTRAINT "person_document_type_check" CHECK ("person"."document_type" in ('CC','TI','CE','PA'))
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"accent_color" text,
	CONSTRAINT "program_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"program_id" uuid,
	CONSTRAINT "role_grant_unique" UNIQUE NULLS NOT DISTINCT("person_id","role","program_id"),
	CONSTRAINT "role_grant_role_check" CHECK ("role_grant"."role" in ('student','teacher','director'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"block_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"teacher_id" uuid NOT NULL,
	"modality" text DEFAULT 'on_site' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"rescheduled_to" uuid,
	"topic" text,
	CONSTRAINT "session_course_start_unique" UNIQUE("course_id","starts_at"),
	CONSTRAINT "session_status_check" CHECK ("session"."status" in ('scheduled','cancelled','rescheduled')),
	CONSTRAINT "session_modality_check" CHECK ("session"."modality" in ('on_site','online'))
);
--> statement-breakpoint
CREATE TABLE "term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"focus" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "track_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "track_course" (
	"track_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	CONSTRAINT "track_course_track_id_course_id_pk" PRIMARY KEY("track_id","course_id")
);
--> statement-breakpoint
ALTER TABLE "absence_notice" ADD CONSTRAINT "absence_notice_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notice" ADD CONSTRAINT "absence_notice_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notice" ADD CONSTRAINT "absence_notice_sent_by_person_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_makeup_request_id_makeup_request_id_fk" FOREIGN KEY ("makeup_request_id") REFERENCES "public"."makeup_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_person_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_made_by_person_id_fk" FOREIGN KEY ("made_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_legal_document_id_legal_document_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_default_teacher_id_person_id_fk" FOREIGN KEY ("default_teacher_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_slot" ADD CONSTRAINT "course_slot_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_person_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_opened_by_change_enrollment_change_id_fk" FOREIGN KEY ("opened_by_change") REFERENCES "public"."enrollment_change"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_closed_by_change_enrollment_change_id_fk" FOREIGN KEY ("closed_by_change") REFERENCES "public"."enrollment_change"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_change" ADD CONSTRAINT "enrollment_change_student_id_person_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_change" ADD CONSTRAINT "enrollment_change_request_id_enrollment_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."enrollment_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_change" ADD CONSTRAINT "enrollment_change_made_by_person_id_fk" FOREIGN KEY ("made_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_student_id_person_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_replaces_enrollment_id_enrollment_id_fk" FOREIGN KEY ("replaces_enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_reviewed_by_person_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document" ADD CONSTRAINT "legal_document_published_by_person_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_ledger" ADD CONSTRAINT "makeup_ledger_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_ledger" ADD CONSTRAINT "makeup_ledger_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_ledger" ADD CONSTRAINT "makeup_ledger_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_request" ADD CONSTRAINT "makeup_request_student_id_person_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_request" ADD CONSTRAINT "makeup_request_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_request" ADD CONSTRAINT "makeup_request_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_request" ADD CONSTRAINT "makeup_request_reviewed_by_person_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_merged_into_person_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_teacher_id_person_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_rescheduled_to_session_id_fk" FOREIGN KEY ("rescheduled_to") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_course" ADD CONSTRAINT "track_course_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_course" ADD CONSTRAINT "track_course_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;