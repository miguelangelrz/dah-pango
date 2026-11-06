CREATE TABLE "session_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"from_teacher_id" uuid NOT NULL,
	"to_teacher_id" uuid NOT NULL,
	"made_by" uuid NOT NULL,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_handoff" ADD CONSTRAINT "session_handoff_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_handoff" ADD CONSTRAINT "session_handoff_from_teacher_id_person_id_fk" FOREIGN KEY ("from_teacher_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_handoff" ADD CONSTRAINT "session_handoff_to_teacher_id_person_id_fk" FOREIGN KEY ("to_teacher_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_handoff" ADD CONSTRAINT "session_handoff_made_by_person_id_fk" FOREIGN KEY ("made_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;