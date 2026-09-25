import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, type User } from "./auth.ts";
import { ensureSchema, pool } from "./db.ts";
import { requireOwner } from "./service.ts";
import { DELIVERY_LIMITS } from "./delivery-limits.ts";

export const agingInput = z
  .object({
    min_days: z.number().int().min(1).max(365).default(3),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const detailsInput = z.object({ parcel_id: z.uuid() }).strict();
export const roundInput = z.object({ window_id: z.uuid() }).strict();
export const exceptionsInput = z
  .object({ limit: z.number().int().min(1).max(100).default(50) })
  .strict();
export const inspectionInput = z
  .object({
    room_name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .transform((s) => s.replace(/\s+/g, " ")),
    occupied_slots: z.number().int().min(0).max(10000),
    capacity_slots: z.number().int().min(1).max(10000).nullable(),
    slot_definition: z.string().trim().min(1).max(200),
    inspected_at: z.iso.datetime(),
    confirmed: z.literal(true),
  })
  .strict();

// Only the trusted operator form records physical observations. There is no
// model-callable tool that can manufacture an inspection or measured weight.
export async function recordRoomInspection(user: User, raw: unknown) {
  requireOwner(user);
  const input = inspectionInput.parse(raw);
  if (new Date(input.inspected_at).getTime() > Date.now())
    throw new AppError("Inspection time cannot be in the future.");
  await ensureSchema();
  const id = randomUUID();
  await pool().query(
    `INSERT INTO room_inspections (id,room_name,occupied_slots,capacity_slots,slot_definition,inspected_at,actor_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.room_name,
      input.occupied_slots,
      input.capacity_slots,
      input.slot_definition,
      input.inspected_at,
      user.id,
    ],
  );
  return { id };
}

export async function roomCapacity(user: User) {
  requireOwner(user);
  await ensureSchema();
  const rooms = (
    await pool()
      .query(`SELECT DISTINCT ON (lower(room_name)) id,room_name,occupied_slots,capacity_slots,slot_definition,inspected_at,recorded_at,
      round(100.0 * occupied_slots / nullif(capacity_slots,0),1)::float AS occupancy_percent,
      CASE WHEN capacity_slots IS NULL THEN NULL ELSE greatest(0,capacity_slots-occupied_slots) END AS free_slots_at_inspection,
      extract(epoch FROM (now()-inspected_at))/3600 AS hours_since_inspection
      FROM room_inspections ORDER BY lower(room_name),inspected_at DESC,recorded_at DESC,id DESC`)
  ).rows;
  return {
    basis: "manual_inspection",
    live: false,
    rooms: rooms.map((r) => ({
      ...r,
      hours_since_inspection: Number(r.hours_since_inspection),
    })),
    limitation:
      "Occupancy describes the last physical inspection, not current occupancy. Slots must have the same definition in occupied and capacity counts. Unknown capacity stays null. Package records and expected emails do not update these observations.",
  };
}

export async function agingPackages(user: User, raw: unknown) {
  requireOwner(user);
  await ensureSchema();
  const input = agingInput.parse(raw);
  const rows = (
    await pool().query(
      `SELECT id,tracking,carrier,location,status,received_at,
      floor(extract(epoch FROM(now()-received_at))/86400)::int AS days_since_intake,
      count(*) OVER()::int AS total_matches
    FROM parcels WHERE status IN ('Needs review','Ready','Scheduled') AND received_at <= now()-($1 * interval '1 day')
    ORDER BY received_at,id LIMIT $2`,
      [input.min_days, input.limit],
    )
  ).rows;
  return {
    as_of: new Date().toISOString(),
    min_days: input.min_days,
    total: rows[0]?.total_matches || 0,
    truncated: (rows[0]?.total_matches || 0) > rows.length,
    parcels: rows.map(({ total_matches: _, ...p }) => p),
    age_basis:
      "Time since recorded intake, not an independent observation of physical presence. Excludes out-for-delivery, delivered and collected records. No notifications sent.",
  };
}

export async function packageDetails(user: User, raw: unknown) {
  await ensureSchema();
  const { parcel_id } = detailsInput.parse(raw);
  const parcel = (
    await pool().query(
      `SELECT id,tracking,carrier,location,status,condition,weight_lbs::float,weight_source,received_at,updated_at,window_id
    FROM parcels WHERE id=$1 AND ($2::boolean OR resident_id=$3)`,
      [parcel_id, user.role === "owner", user.id],
    )
  ).rows[0];
  if (!parcel) throw new AppError("Parcel not found.", 404);
  return {
    parcel,
    weight_note:
      "Weight is an operator-entered value. Source describes the operator's declaration: scale, label, estimate or unverified. It is not a live scale reading or carrier lookup.",
  };
}

export async function packageExceptions(user: User, raw: unknown) {
  requireOwner(user);
  await ensureSchema();
  const { limit } = exceptionsInput.parse(raw);
  const rows = (
    await pool().query(
      `SELECT id,tracking,status,location,received_at,
    array_remove(ARRAY[
      CASE WHEN status='Needs review' THEN 'needs_review' END,
      CASE WHEN resident_id IS NULL THEN 'recipient_unmatched' END,
      CASE WHEN condition='Visible damage' THEN 'visible_damage' END,
      CASE WHEN weight_source IN ('unverified','estimate') THEN 'weight_not_verified' END
    ],NULL) AS reasons, count(*) OVER()::int AS total_matches
    FROM parcels WHERE status NOT IN ('Delivered','Collected') AND
      (status='Needs review' OR resident_id IS NULL OR condition='Visible damage' OR weight_source IN ('unverified','estimate'))
    ORDER BY (status='Needs review') DESC,received_at,id LIMIT $1`,
      [limit],
    )
  ).rows;
  return {
    total: rows[0]?.total_matches || 0,
    truncated: (rows[0]?.total_matches || 0) > rows.length,
    parcels: rows.map(({ total_matches: _, ...p }) => p),
    note: "Review queue only. Does not resolve exceptions or change custody.",
  };
}

export async function previewDeliveryRound(user: User, raw: unknown) {
  requireOwner(user);
  await ensureSchema();
  const { window_id } = roundInput.parse(raw);
  // One SQL statement gives the window and its bookings a consistent snapshot.
  const row = (
    await pool().query(
      `SELECT w.*,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'tracking',p.tracking,'resident_id',p.resident_id,
      'unit',u.unit,'status',p.status,'location',p.location,'weight_lbs',p.weight_lbs,'weight_source',p.weight_source)
      ORDER BY u.unit,p.received_at,p.id) FROM parcels p LEFT JOIN users u ON u.id=p.resident_id
      WHERE p.window_id=w.id AND p.status IN ('Scheduled','Out for delivery','Delivered')),'[]'::jsonb) AS bookings
    FROM delivery_windows w WHERE w.id=$1`,
      [window_id],
    )
  ).rows[0];
  if (!row) throw new AppError("Delivery window not found.", 404);
  const bookings = row.bookings as {
    id: string;
    resident_id: string;
    status: string;
    weight_lbs: number;
    weight_source: string;
  }[];
  const recordedWeight = bookings.reduce((s, p) => s + Number(p.weight_lbs), 0);
  const stops = new Set(bookings.map((p) => p.resident_id)).size;
  const uncertain = bookings.filter((p) =>
    ["unverified", "estimate"].includes(p.weight_source),
  ).length;
  const { bookings: _, ...window } = row;
  return {
    as_of: new Date().toISOString(),
    preview_only: true,
    window,
    bookings,
    totals: {
      booked_parcels: bookings.length,
      booked_stops: stops,
      recorded_weight_lbs: Math.round(recordedWeight * 100) / 100,
      unverified_weight_parcels: uncertain,
      remaining_to_deliver: bookings.filter((p) => p.status !== "Delivered")
        .length,
    },
    limits: { stops: row.capacity, ...DELIVERY_LIMITS },
    remaining_capacity: {
      stops: Math.max(0, row.capacity - stops),
      parcels: Math.max(0, DELIVERY_LIMITS.parcels - bookings.length),
      recorded_weight_lbs: Math.max(
        0,
        Math.round((DELIVERY_LIMITS.weight_lbs - recordedWeight) * 100) / 100,
      ),
    },
    warnings: [
      ...(uncertain
        ? [
            "Some weights are estimates or unverified. The recorded total is not a measured load.",
          ]
        : []),
      ...(new Date(row.cutoff_at).getTime() <= Date.now()
        ? ["Booking cutoff has passed."]
        : []),
    ],
    limitation:
      "Existing bookings only; does not create a route, reserve capacity, add packages, or authorize delivery. Delivered bookings still consume the window's booking limits. Final checks run at booking.",
  };
}
