CREATE TABLE label_drafts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 extracted jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 consumed_at timestamptz,
 parcel_id uuid REFERENCES parcels(id)
);
