-- Defensive `updated_at` maintenance: even though the application code sets
-- updated_at on every write, a DB-level trigger guarantees it can never be
-- forgotten in a future code path. This matters because the reconciliation
-- pass relies on `updated_at` to detect stale "processing" rows left behind
-- by a crashed worker.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER email_jobs_set_updated_at
BEFORE UPDATE ON "email_jobs"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
