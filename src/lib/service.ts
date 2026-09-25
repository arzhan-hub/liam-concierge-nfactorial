import { randomUUID } from "node:crypto";
import type pg from "pg";
import { pool, ensureSchema, transaction } from "./db.ts";
import { AppError, token, digest, type User } from "./auth.ts";
import * as schemas from "./validation.ts";
import { DELIVERY_LIMITS } from "./delivery-limits.ts";

const normalize = (s: string) => s.trim().replace(/\s+/g, "").toUpperCase();
export function requireOwner(user: User) {
  if (user.role !== "owner") throw new AppError("Owner access required.", 403);
}
async function event(
  db: pg.PoolClient,
  parcel: string,
  user: User,
  from: string | null,
  to: string,
  note: string,
) {
  await db.query(
    "INSERT INTO events (id,parcel_id,actor_id,from_status,to_status,note) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), parcel, user.id, from, to, note],
  );
}
export async function dashboard(user: User) {
  await ensureSchema();
  const owner = user.role === "owner";
  const membership = (
    await pool().query(
      "SELECT verified_at,profile_submitted_at,name,unit FROM users WHERE id=$1",
      [user.id],
    )
  ).rows[0];
  if (!owner && !membership?.verified_at)
    return {
      user: { ...user, ...membership },
      parcels: [],
      residents: [],
      windows: [],
      events: [],
      metrics: [],
      rehearsal: process.env.LIVE_OPERATIONS !== "true",
      timezone: "America/New_York",
    };
  const filter = owner ? "" : "WHERE p.resident_id=$1";
  const values = owner ? [] : [user.id];
  const [parcels, residents, windows, events, metrics] = await Promise.all([
    pool().query(
      `SELECT p.*,u.name AS resident_name,u.unit AS resident_unit,w.starts_at,w.ends_at FROM parcels p
      LEFT JOIN users u ON u.id=p.resident_id LEFT JOIN delivery_windows w ON w.id=p.window_id ${filter} ORDER BY p.received_at DESC`,
      values,
    ),
    owner
      ? pool().query(
          "SELECT id,name,email,unit,verified_at,profile_submitted_at,(password_hash IS NOT NULL OR firebase_uid IS NOT NULL) AS activated FROM users WHERE role='resident' ORDER BY verified_at NULLS FIRST,name",
        )
      : Promise.resolve({ rows: [] }),
    pool()
      .query(`SELECT w.*,count(DISTINCT p.resident_id)::int AS booked_stops,count(p.id)::int AS parcel_count,
      coalesce(sum(p.weight_lbs),0)::float AS weight_lbs FROM delivery_windows w
      LEFT JOIN parcels p ON p.window_id=w.id AND p.status IN ('Scheduled','Out for delivery','Delivered')
      WHERE w.ends_at > now() - interval '1 day' GROUP BY w.id ORDER BY starts_at`),
    pool().query(
      `SELECT e.*,p.tracking,u.name AS actor_name FROM events e JOIN parcels p ON p.id=e.parcel_id JOIN users u ON u.id=e.actor_id
      ${filter} ORDER BY e.created_at DESC LIMIT 100`,
      values,
    ),
    owner
      ? pool().query("SELECT * FROM daily_metrics ORDER BY day DESC LIMIT 31")
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    user: { ...user, ...membership },
    parcels: parcels.rows,
    residents: residents.rows,
    windows: windows.rows,
    events: events.rows,
    metrics: metrics.rows,
    rehearsal: process.env.LIVE_OPERATIONS !== "true",
    timezone: "America/New_York",
  };
}
export async function inviteResident(user: User, raw: unknown) {
  requireOwner(user);
  const input = schemas.invitation.parse(raw);
  const rawToken = token();
  await transaction(async (db) => {
    const existing = (
      await db.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [
        input.email,
      ])
    ).rows[0];
    if (existing?.role === "owner")
      throw new AppError("This email belongs to the owner.");
    if (
      existing &&
      (existing.unit !== input.unit || existing.name !== input.name)
    )
      throw new AppError(
        "An account already exists with different resident details. Resolve the identity before issuing an invitation.",
      );
    const id = existing?.id ?? randomUUID();
    if (!existing)
      await db.query(
        "INSERT INTO users (id,email,name,unit,role,verified_at) VALUES ($1,$2,$3,$4,'resident',now())",
        [id, input.email, input.name, input.unit],
      );
    await db.query(
      "UPDATE invitations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [id],
    );
    await db.query(
      "INSERT INTO invitations (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '7 days')",
      [digest(rawToken), id],
    );
  });
  return {
    url: `${process.env.APP_URL || "http://localhost:3000"}/activate#${rawToken}`,
  };
}
export async function receiveParcel(user: User, raw: unknown, connection?:pg.PoolClient) {
  requireOwner(user);
  const input = schemas.intake.parse(raw);
  const execute=async (db:pg.PoolClient) => {
    let status = "Needs review";
    if (input.resident_id) {
      const resident = (
        await db.query(
          "SELECT * FROM users WHERE id=$1 AND role='resident' AND verified_at IS NOT NULL",
          [input.resident_id],
        )
      ).rows[0];
      if (!resident) throw new AppError("Choose a verified resident.");
      if (normalize(resident.unit) !== normalize(input.label_unit))
        throw new AppError(
          "Label unit conflicts with the resident. Receive this parcel into review without a resident match.",
        );
      if (input.condition === "Intact" && !input.exception_reason)
        status = "Ready";
    }
    const reason =
      input.exception_reason ||
      (input.condition === "Visible damage"
        ? "Visible exterior damage — review before release."
        : status === "Needs review"
          ? "Recipient requires confirmation."
          : "");
    const id = randomUUID();
    await db.query(
      `INSERT INTO parcels (id,tracking,carrier,resident_id,label_name,label_unit,location,status,condition,weight_lbs,exception_reason,weight_source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        input.tracking,
        input.carrier,
        input.resident_id,
        input.label_name,
        input.label_unit,
        input.location,
        status,
        input.condition,
        input.weight_lbs,
        reason,
        input.weight_source,
      ],
    );
    await event(
      db,
      id,
      user,
      null,
      status,
      `Received at ${input.location}. ${reason}`,
    );
    return { id };
  };
  return connection?execute(connection):transaction(execute);
}
export async function createWindow(user: User, raw: unknown) {
  requireOwner(user);
  const input = schemas.windowInput.parse(raw);
  const start = new Date(input.starts_at);
  if (start.getTime() < Date.now() + 31 * 60000)
    throw new AppError("Open a window at least 31 minutes from now.");
  if (start.getTime() > Date.now() + 31 * 86400000)
    throw new AppError("Open windows within the next 31 days.");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  await pool().query(
    `INSERT INTO delivery_windows (id,starts_at,ends_at,cutoff_at,capacity,service_date) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      start,
      new Date(start.getTime() + 3600000),
      new Date(start.getTime() - 1800000),
      input.capacity,
      day,
    ],
  );
  return {};
}
export async function scheduleDelivery(user: User, raw: unknown, connection?:pg.PoolClient) {
  if (
    user.role !== "owner" &&
    !(
      await (connection || pool()).query(
        "SELECT 1 FROM users WHERE id=$1 AND verified_at IS NOT NULL",
        [user.id],
      )
    ).rowCount
  )
    throw new AppError(
      "Residency verification is required before delivery requests.",
      403,
    );
  const input = schemas.requestDelivery.parse(raw);
  const execute=async (db:pg.PoolClient) => {
    const window = (
      await db.query("SELECT * FROM delivery_windows WHERE id=$1 FOR UPDATE", [
        input.window_id,
      ])
    ).rows[0];
    if (!window || new Date(window.cutoff_at).getTime() <= Date.now())
      throw new AppError("This delivery window is closed.");
    const parcel = (
      await db.query("SELECT * FROM parcels WHERE id=$1 FOR UPDATE", [
        input.parcel_id,
      ])
    ).rows[0];
    if (!parcel || (user.role !== "owner" && parcel.resident_id !== user.id))
      throw new AppError("Parcel not found.", 404);
    if (parcel.status !== "Ready")
      throw new AppError("Only a ready parcel can be scheduled.");
    const booked = (
      await db.query(
        "SELECT resident_id,weight_lbs FROM parcels WHERE window_id=$1 AND status IN ('Scheduled','Out for delivery','Delivered')",
        [window.id],
      )
    ).rows;
    const stops = new Set(booked.map((p) => p.resident_id));
    if (!stops.has(parcel.resident_id) && stops.size >= window.capacity)
      throw new AppError("This window has reached its stop limit.");
    if (
      booked.length >= DELIVERY_LIMITS.parcels ||
      booked.reduce((sum, p) => sum + Number(p.weight_lbs), 0) +
        Number(parcel.weight_lbs) >
        DELIVERY_LIMITS.weight_lbs
    )
      throw new AppError("This window has reached its parcel or weight limit.");
    if (booked.filter((p) => p.resident_id === parcel.resident_id).length >= DELIVERY_LIMITS.parcels_per_resident)
      throw new AppError(
        "A resident can request up to three parcels in one window.",
      );
    await db.query(
      "UPDATE parcels SET status='Scheduled',window_id=$1,updated_at=now() WHERE id=$2",
      [window.id, parcel.id],
    );
    await event(
      db,
      parcel.id,
      user,
      "Ready",
      "Scheduled",
      `Resident handoff requested for ${new Date(window.starts_at).toISOString()}.`,
    );
    return {};
  };
  return connection?execute(connection):transaction(execute);
}
export async function transitionParcel(user: User, raw: unknown) {
  const input = schemas.transition.parse(raw);
  if (input.action !== "cancel") requireOwner(user);
  return transaction(async (db) => {
    const parcel = (
      await db.query(
        `SELECT p.*,u.unit AS resident_unit FROM parcels p LEFT JOIN users u ON u.id=p.resident_id WHERE p.id=$1 FOR UPDATE OF p`,
        [input.id],
      )
    ).rows[0];
    if (!parcel || (user.role !== "owner" && parcel.resident_id !== user.id))
      throw new AppError("Parcel not found.", 404);
    const allowed: Record<string, string[]> = {
      resolve: ["Needs review"],
      load: ["Scheduled"],
      deliver: ["Out for delivery"],
      collect: ["Ready", "Scheduled"],
      exception: ["Ready", "Scheduled", "Out for delivery"],
      cancel: ["Scheduled"],
    };
    if (!allowed[input.action].includes(parcel.status))
      throw new AppError("The parcel has changed. Refresh and try again.");
    let next = "",
      note = input.note,
      resident = parcel.resident_id,
      location = parcel.location,
      reason = parcel.exception_reason;
    if (["load", "deliver", "collect"].includes(input.action)) {
      if (normalize(input.tracking) !== normalize(parcel.tracking))
        throw new AppError("Tracking number does not match this parcel.");
      if (!input.confirmed)
        throw new AppError(
          "Confirm the physical verification before continuing.",
        );
    }
    if (
      ["deliver", "collect"].includes(input.action) &&
      normalize(input.unit) !== normalize(parcel.resident_unit)
    )
      throw new AppError("Unit does not match the verified resident.");
    switch (input.action) {
      case "resolve": {
        if (
          !input.resident_id ||
          !input.location ||
          !input.note ||
          !input.confirmed
        )
          throw new AppError(
            "Confirm the recipient, location, and how the exception was resolved.",
          );
        const matched = (
          await db.query(
            "SELECT id FROM users WHERE id=$1 AND role='resident' AND verified_at IS NOT NULL",
            [input.resident_id],
          )
        ).rows[0];
        if (!matched) throw new AppError("Choose a verified resident.");
        resident = matched.id;
        location = input.location;
        reason = "";
        next = "Ready";
        break;
      }
      case "load":
        next = "Out for delivery";
        note = `Tracking verified at load. ${note}`;
        break;
      case "deliver":
        next = "Delivered";
        note = `Tracking and unit verified; handed directly to the verified resident. ${note}`;
        break;
      case "collect":
        next = "Collected";
        note = `Tracking, unit, and resident identity verified at collection. ${note}`;
        break;
      case "exception":
        if (!note) throw new AppError("Describe the exception.");
        next = "Needs review";
        reason = note;
        break;
      case "cancel":
        next = "Ready";
        note = "Scheduled delivery cancelled; parcel available for pickup.";
        break;
    }
    const window = ["Ready", "Needs review", "Collected"].includes(next)
      ? null
      : parcel.window_id;
    await db.query(
      "UPDATE parcels SET status=$1,resident_id=$2,location=$3,exception_reason=$4,window_id=$5,updated_at=now() WHERE id=$6",
      [next, resident, location, reason, window, parcel.id],
    );
    await event(
      db,
      parcel.id,
      user,
      parcel.status,
      next,
      note || "Status updated.",
    );
    return {};
  });
}
export async function saveMetrics(user: User, raw: unknown) {
  requireOwner(user);
  const input = schemas.metricInput.parse(raw);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (input.day > today)
    throw new AppError("Daily results cannot be dated in the future.");
  await pool().query(
    `INSERT INTO daily_metrics (day,minutes,interruptions,search_seconds,note,actor_id) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT(day) DO UPDATE SET minutes=excluded.minutes,interruptions=excluded.interruptions,search_seconds=excluded.search_seconds,note=excluded.note,actor_id=excluded.actor_id,updated_at=now()`,
    [
      input.day,
      input.minutes,
      input.interruptions,
      input.search_seconds,
      input.note,
      user.id,
    ],
  );
  return {};
}
