ALTER TABLE parcels ADD COLUMN weight_source text NOT NULL DEFAULT 'unverified'
  CHECK (weight_source IN ('unverified','estimate','label','scale'));

CREATE TABLE room_inspections (
  id uuid PRIMARY KEY,
  room_name text NOT NULL CHECK (length(room_name) BETWEEN 1 AND 80),
  occupied_slots integer NOT NULL CHECK (occupied_slots BETWEEN 0 AND 10000),
  capacity_slots integer CHECK (capacity_slots BETWEEN 1 AND 10000),
  slot_definition text NOT NULL CHECK (length(slot_definition) BETWEEN 1 AND 200),
  inspected_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX room_inspections_latest ON room_inspections(lower(room_name), inspected_at DESC, recorded_at DESC);
CREATE TRIGGER immutable_room_inspections BEFORE UPDATE OR DELETE ON room_inspections
FOR EACH ROW EXECUTE FUNCTION prevent_event_changes();
