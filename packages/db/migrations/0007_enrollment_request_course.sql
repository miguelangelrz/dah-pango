ALTER TABLE "enrollment" DROP CONSTRAINT "enrollment_dates_check";--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD COLUMN "replaces_course_id" uuid;--> statement-breakpoint
ALTER TABLE "enrollment_request" ADD CONSTRAINT "enrollment_request_replaces_course_id_course_id_fk" FOREIGN KEY ("replaces_course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_dates_check" CHECK ("enrollment"."valid_from" <= "enrollment"."valid_to" + 1);