ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_submitted_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE TABLE IF NOT EXISTS account_events (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES users(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  event_type text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_account_events BEFORE UPDATE OR DELETE ON account_events
FOR EACH ROW EXECUTE FUNCTION prevent_event_changes();
