-- Custom SQL migration file, put your code below! ---- Handoffs are a log: rows are never changed or removed.
CREATE TRIGGER session_handoff_append_only BEFORE UPDATE OR DELETE ON session_handoff
  FOR EACH ROW EXECUTE FUNCTION reject_change();
