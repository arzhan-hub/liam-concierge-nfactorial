CREATE TABLE assistant_runs (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 mode text NOT NULL CHECK(mode IN ('guided','ai')),
 status text NOT NULL DEFAULT 'running',
 message text NOT NULL,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_runs_user ON assistant_runs(user_id,created_at DESC);
CREATE TABLE assistant_capabilities (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 run_id uuid NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
 session_hash text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE assistant_approvals (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL UNIQUE REFERENCES assistant_runs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 parcel_id uuid NOT NULL REFERENCES parcels(id),
 window_id uuid NOT NULL REFERENCES delivery_windows(id),
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 result jsonb
);
