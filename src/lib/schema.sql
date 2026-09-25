CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text,
  role text NOT NULL CHECK (role IN ('owner', 'resident')),
  password_hash text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(role) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS login_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  resets_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_windows (
  id uuid PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 10),
  service_date date NOT NULL UNIQUE,
  CHECK (ends_at > starts_at AND cutoff_at < starts_at)
);
CREATE TABLE IF NOT EXISTS parcels (
  id uuid PRIMARY KEY,
  tracking text NOT NULL UNIQUE,
  carrier text NOT NULL,
  resident_id uuid REFERENCES users(id),
  label_name text NOT NULL,
  label_unit text NOT NULL,
  location text NOT NULL,
  status text NOT NULL CHECK (status IN ('Needs review', 'Ready', 'Scheduled', 'Out for delivery', 'Delivered', 'Collected')),
  condition text NOT NULL CHECK (condition IN ('Intact', 'Visible damage')),
  weight_lbs numeric(5,2) NOT NULL CHECK (weight_lbs > 0 AND weight_lbs <= 25),
  exception_reason text,
  window_id uuid REFERENCES delivery_windows(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'Needs review' OR resident_id IS NOT NULL),
  CHECK (status NOT IN ('Scheduled', 'Out for delivery') OR window_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  parcel_id uuid NOT NULL REFERENCES parcels(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  from_status text,
  to_status text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parcels_resident ON parcels(resident_id);
CREATE INDEX IF NOT EXISTS events_parcel ON events(parcel_id, created_at);
CREATE TABLE IF NOT EXISTS daily_metrics (
  day date PRIMARY KEY,
  minutes integer NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  interruptions integer NOT NULL CHECK (interruptions BETWEEN 0 AND 10000),
  search_seconds integer CHECK (search_seconds BETWEEN 0 AND 3600),
  note text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION prevent_event_changes() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Custody events are append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS immutable_events ON events;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON events
FOR EACH ROW EXECUTE FUNCTION prevent_event_changes();
