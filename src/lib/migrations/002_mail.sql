CREATE TABLE mail_connections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mailbox text NOT NULL UNIQUE,
  refresh_token_cipher text NOT NULL,
  consent_version text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_error text,
  next_page_token text,
  search_query text
);
CREATE TABLE mail_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  browser_hash text NOT NULL,
  verifier_cipher text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE mail_imports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('gmail','paste')),
  source_key text NOT NULL,
  received_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,source,source_key)
);
CREATE TABLE expected_deliveries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  carrier text NOT NULL,
  tracking text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,carrier,tracking)
);
CREATE TABLE expected_delivery_sources (
  delivery_id uuid NOT NULL REFERENCES expected_deliveries(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES mail_imports(id) ON DELETE CASCADE,
  email_claim text NOT NULL CHECK (email_claim IN ('Mentioned','Shipped','Out for delivery','Reported delivered')),
  PRIMARY KEY(delivery_id,import_id)
);
CREATE INDEX expected_deliveries_user ON expected_deliveries(user_id);
