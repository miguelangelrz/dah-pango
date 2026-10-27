-- Backstops for the rules the API enforces.

-- 1. Attendance is frozen 24 hours after the session ends.
--    The lock job (unmarked -> absent) sets `app.lock_job = 'on'` for its own transaction.
CREATE FUNCTION attendance_respect_lock() RETURNS trigger AS $$
DECLARE
  sid uuid := COALESCE(NEW.session_id, OLD.session_id);
  lock_at timestamptz;
BEGIN
  SELECT ends_at + interval '24 hours' INTO lock_at FROM session WHERE id = sid;
  IF now() >= lock_at AND COALESCE(current_setting('app.lock_job', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Attendance for session % is locked since %', sid, lock_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attendance_lock
  BEFORE INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION attendance_respect_lock();
--> statement-breakpoint

-- 2. Append-only history tables.
CREATE FUNCTION reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attendance_event_append_only BEFORE UPDATE OR DELETE ON attendance_event
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER makeup_ledger_append_only BEFORE UPDATE OR DELETE ON makeup_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER consent_append_only BEFORE UPDATE OR DELETE ON consent
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER enrollment_change_append_only BEFORE UPDATE OR DELETE ON enrollment_change
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint

-- 3. Inscripciones are never deleted; the only update allowed is closing one.
CREATE FUNCTION enrollment_close_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inscripciones are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closed_by_change IS NOT NULL
     OR NEW.closed_by_change IS NULL
     OR NEW.valid_to > OLD.valid_to
     OR (NEW.id, NEW.student_id, NEW.term_id, NEW.track_id, NEW.course_id, NEW.valid_from, NEW.opened_by_change)
        IS DISTINCT FROM
        (OLD.id, OLD.student_id, OLD.term_id, OLD.track_id, OLD.course_id, OLD.valid_from, OLD.opened_by_change)
  THEN
    RAISE EXCEPTION 'An inscripcion can only be closed once, by a change record'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER enrollment_close_only
  BEFORE UPDATE OR DELETE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION enrollment_close_only();
