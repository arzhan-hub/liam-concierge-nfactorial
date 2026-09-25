import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, ensureSchema } from "../src/lib/db.ts";
import { newSession, digest, type User } from "../src/lib/auth.ts";
import { openResidentMcp } from "../src/lib/assistant/mcp.ts";
import { callOperationTool } from "../src/lib/assistant/operations-tools.ts";
import { inspectThroughMcp } from "../src/lib/operations-mcp.ts";
import { recordRoomInspection } from "../src/lib/operations.ts";
import { receiveParcel } from "../src/lib/service.ts";

const original = process.env.DATABASE_URL!;
const schema = `liam_mcp_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: original });
const owner: User = {
  id: randomUUID(),
  email: "operator@example.test",
  name: "Operator",
  unit: null,
  role: "owner",
};
const alice: User = {
  id: randomUUID(),
  email: "alice@example.test",
  name: "Alice",
  unit: "101",
  role: "resident",
};
const bob: User = {
  id: randomUUID(),
  email: "bob@example.test",
  name: "Bob",
  unit: "102",
  role: "resident",
};
let ownerSession: string, aliceSession: string;
let operator: Awaited<ReturnType<typeof openResidentMcp>>,
  resident: Awaited<ReturnType<typeof openResidentMcp>>;
const parcelIds: Record<string, string> = {};
const windowId = randomUUID();
async function connect(user: User, session: string) {
  const run = randomUUID();
  await pool().query(
    "INSERT INTO assistant_runs(id,user_id,mode,message) VALUES ($1,$2,'guided','Protocol test')",
    [run, user.id],
  );
  return openResidentMcp(user, session, run);
}
before(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  await ensureSchema();
  for (const u of [owner, alice, bob])
    await pool().query(
      "INSERT INTO users(id,email,name,unit,role,verified_at) VALUES ($1,$2,$3,$4,$5,now())",
      [u.id, u.email, u.name, u.unit, u.role],
    );
  ownerSession = await newSession(owner.id);
  aliceSession = await newSession(alice.id);
  operator = await connect(owner, ownerSession);
  resident = await connect(alice, aliceSession);
  await pool().query(
    "INSERT INTO delivery_windows(id,starts_at,ends_at,cutoff_at,capacity,service_date) VALUES ($1,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours',2,current_date+1)",
    [windowId],
  );
  const fixtures = [
    ["ready", alice.id, "Ready", "scale", 5, 5],
    ["scheduled", alice.id, "Scheduled", "label", 6, 5],
    ["out", bob.id, "Out for delivery", "estimate", 7, 5],
    ["delivered", bob.id, "Delivered", "scale", 8, 5],
    ["collected", alice.id, "Collected", "scale", 3, 5],
    ["review", null, "Needs review", "unverified", 4, 5],
    ["fresh", bob.id, "Ready", "unverified", 2, 0],
  ] as const;
  for (const [name, user, status, weightSource, weight, age] of fixtures) {
    const id = (parcelIds[name] = randomUUID());
    await pool().query(
      `INSERT INTO parcels(id,tracking,carrier,resident_id,label_name,label_unit,location,status,condition,weight_lbs,weight_source,window_id,received_at)
      VALUES ($1,$2,'Other',$3,'Fictional','Test','Test shelf',$4,'Intact',$5,$6,$7,now()-($8*interval '1 day'))`,
      [
        id,
        `FIXTURE-${name}`,
        user,
        status,
        weight,
        weightSource,
        ["Scheduled", "Out for delivery", "Delivered"].includes(status)
          ? windowId
          : null,
        age,
      ],
    );
  }
});
after(async () => {
  await operator?.close();
  await resident?.close();
  await pool().end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  process.env.DATABASE_URL = original;
});

test("MCP protocol advertises eight operator tools and four resident tools", async () => {
  const all = (await operator.list()).tools;
  assert.equal(all.length, 8);
  assert.equal(
    all.find((t) => t.name === "get_room_capacity")?.annotations?.readOnlyHint,
    true,
  );
  assert.deepEqual(
    (await resident.list()).tools.map((t) => t.name).sort(),
    [
      "get_parcels",
      "get_available_windows",
      "request_delivery",
      "get_package_details",
    ].sort(),
  );
  await assert.rejects(() => resident.call("get_room_capacity"));
  await assert.rejects(
    () => inspectThroughMcp(aliceSession, { tool: "get_room_capacity" }),
    /Owner access/,
  );
});
test("unknown room capacity stays unknown; inspections preserve time, units and overflow", async () => {
  const initial = await operator.call<{ rooms: unknown[]; live: boolean }>(
    "get_room_capacity",
  );
  assert.deepEqual(initial.rooms, []);
  assert.equal(initial.live, false);
  const inspection = {
    room_name: "Overflow",
    occupied_slots: 12,
    capacity_slots: 10,
    slot_definition: "One marked standard-box space",
    inspected_at: new Date(Date.now() - 3600000).toISOString(),
    confirmed: true,
  };
  await assert.rejects(
    () => recordRoomInspection(alice, inspection),
    /Owner access/,
  );
  await assert.rejects(() =>
    recordRoomInspection(owner, { ...inspection, confirmed: false }),
  );
  await assert.rejects(
    () =>
      recordRoomInspection(owner, {
        ...inspection,
        inspected_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    /future/,
  );
  await recordRoomInspection(owner, inspection);
  // Older observations entered later must not replace a more recent inspection.
  await recordRoomInspection(owner, {
    ...inspection,
    room_name: "overflow",
    occupied_slots: 1,
    inspected_at: new Date(Date.now() - 7200000).toISOString(),
  });
  await recordRoomInspection(owner, {
    ...inspection,
    room_name: "Mail room",
    capacity_slots: null,
  });
  const result = await operator.call<{
    rooms: {
      room_name: string;
      occupancy_percent: number | null;
      capacity_slots: number | null;
      free_slots_at_inspection: number | null;
      hours_since_inspection: number;
    }[];
  }>("get_room_capacity");
  assert.equal(result.rooms.length, 2);
  const overflow = result.rooms.find((r) => r.room_name === "Overflow")!;
  assert.equal(overflow.occupancy_percent, 120);
  assert.equal(overflow.free_slots_at_inspection, 0);
  assert.ok(overflow.hours_since_inspection >= 1);
  const unknown = result.rooms.find((r) => r.room_name === "Mail room")!;
  assert.equal(unknown.occupancy_percent, null);
  assert.equal(unknown.free_slots_at_inspection, null);
  await assert.rejects(
    () => pool().query("DELETE FROM room_inspections"),
    /append-only/,
  );
});
test("aging uses physical-intake records and excludes completed and in-transit parcels", async () => {
  const result = await operator.call<{
    parcels: { id: string; days_since_intake: number }[];
    total: number;
    truncated: boolean;
  }>("get_aging_packages", { min_days: 3 });
  assert.deepEqual(
    result.parcels.map((p) => p.id).sort(),
    [parcelIds.ready, parcelIds.scheduled, parcelIds.review].sort(),
  );
  assert.equal(result.total, 3);
  assert.ok(result.parcels.every((p) => p.days_since_intake >= 5));
  const limited = await operator.call<{
    total: number;
    truncated: boolean;
    parcels: unknown[];
  }>("get_aging_packages", { min_days: 3, limit: 1 });
  assert.equal(limited.total, 3);
  assert.equal(limited.truncated, true);
  assert.equal(limited.parcels.length, 1);
  await assert.rejects(() =>
    operator.call("get_aging_packages", { min_days: -1 }),
  );
  await assert.rejects(() =>
    operator.call("get_aging_packages", { min_days: 3, resident_id: bob.id }),
  );
});
test("package detail tools enforce resident ownership and never infer weight source", async () => {
  const own = await resident.call<{
    parcel: { id: string; weight_lbs: number; weight_source: string };
  }>("get_package_details", { parcel_id: parcelIds.ready });
  assert.equal(own.parcel.weight_lbs, 5);
  assert.equal(own.parcel.weight_source, "scale");
  await assert.rejects(
    () => resident.call("get_package_details", { parcel_id: parcelIds.fresh }),
    /Parcel not found/,
  );
  await assert.rejects(
    () => operator.call("get_package_details", { parcel_id: randomUUID() }),
    /Parcel not found/,
  );
  const other = await operator.call<{ parcel: { weight_source: string } }>(
    "get_package_details",
    { parcel_id: parcelIds.fresh },
  );
  assert.equal(other.parcel.weight_source, "unverified");
});
test("exception tool distinguishes operational issues and weight uncertainty", async () => {
  const result = await operator.call<{
    parcels: { id: string; reasons: string[] }[];
  }>("get_package_exceptions");
  const review = result.parcels.find((p) => p.id === parcelIds.review)!;
  assert.deepEqual(review.reasons, [
    "needs_review",
    "recipient_unmatched",
    "weight_not_verified",
  ]);
  assert.ok(result.parcels.some((p) => p.id === parcelIds.out));
  assert.ok(
    !result.parcels.some((p) =>
      [parcelIds.ready, parcelIds.delivered, parcelIds.collected].includes(
        p.id,
      ),
    ),
  );
});
test("round preview accounts for delivered bookings, flags uncertain weight, and makes no mutations", async () => {
  const before = (
    await pool().query("SELECT id,status,window_id FROM parcels ORDER BY id")
  ).rows;
  const result = await operator.call<{
    preview_only: boolean;
    totals: {
      booked_parcels: number;
      booked_stops: number;
      recorded_weight_lbs: number;
      unverified_weight_parcels: number;
      remaining_to_deliver: number;
    };
    remaining_capacity: {
      stops: number;
      parcels: number;
      recorded_weight_lbs: number;
    };
    warnings: string[];
  }>("preview_delivery_round", { window_id: windowId });
  assert.equal(result.preview_only, true);
  assert.deepEqual(result.totals, {
    booked_parcels: 3,
    booked_stops: 2,
    recorded_weight_lbs: 21,
    unverified_weight_parcels: 1,
    remaining_to_deliver: 2,
  });
  assert.deepEqual(result.remaining_capacity, {
    stops: 0,
    parcels: 17,
    recorded_weight_lbs: 129,
  });
  assert.ok(result.warnings.length);
  assert.deepEqual(
    (await pool().query("SELECT id,status,window_id FROM parcels ORDER BY id"))
      .rows,
    before,
  );
  await assert.rejects(
    () => operator.call("preview_delivery_round", { window_id: randomUUID() }),
    /not found/,
  );
});
test("intake captures explicit weight source and defaults old clients to unverified", async () => {
  const base = {
    tracking: "INTAKE-SCALE",
    carrier: "Other",
    label_name: alice.name,
    label_unit: alice.unit,
    location: "Test shelf",
    resident_id: alice.id,
    condition: "Intact",
    weight_lbs: 4,
    exception_reason: "",
    safe_standard: true,
  };
  const first = await receiveParcel(owner, { ...base, weight_source: "scale" });
  const second = await receiveParcel(owner, {
    ...base,
    tracking: "INTAKE-LEGACY",
  });
  const results = (
    await pool().query(
      "SELECT id,weight_source FROM parcels WHERE id=ANY($1::uuid[])",
      [[first.id, second.id]],
    )
  ).rows;
  assert.equal(results.find((p) => p.id === first.id).weight_source, "scale");
  assert.equal(
    results.find((p) => p.id === second.id).weight_source,
    "unverified",
  );
});
test("existing MCP tools read only own parcels and require an explicit, single-use booking approval", async () => {
  const own = await resident.call<{ parcels: { id: string }[] }>("get_parcels");
  assert.ok(own.parcels.some((p) => p.id === parcelIds.ready));
  assert.ok(!own.parcels.some((p) => p.id === parcelIds.fresh));
  const windows = await resident.call<{ windows: { id: string }[] }>(
    "get_available_windows",
  );
  assert.ok(windows.windows.some((w) => w.id === windowId));
  await assert.rejects(
    () => resident.call("request_delivery", { approval_id: randomUUID() }),
    /explicit resident confirmation/,
  );
  const run = (
    await pool().query(
      "SELECT run_id FROM assistant_capabilities WHERE user_id=$1",
      [alice.id],
    )
  ).rows[0].run_id;
  const approval = randomUUID();
  await pool().query(
    "INSERT INTO assistant_approvals(id,run_id,user_id,parcel_id,window_id,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')",
    [approval, run, alice.id, parcelIds.ready, windowId],
  );
  const [first, second] = await Promise.all([
    resident.call("request_delivery", { approval_id: approval }),
    resident.call("request_delivery", { approval_id: approval }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(
    (
      await pool().query("SELECT status FROM parcels WHERE id=$1", [
        parcelIds.ready,
      ])
    ).rows[0].status,
    "Scheduled",
  );
  assert.equal(
    (
      await pool().query(
        "SELECT count(*)::int AS n FROM events WHERE parcel_id=$1 AND to_status='Scheduled'",
        [parcelIds.ready],
      )
    ).rows[0].n,
    1,
  );
});
test("operator workspace calls the real MCP server and clears its capability", async () => {
  const before = (
    await pool().query("SELECT count(*)::int AS n FROM assistant_capabilities")
  ).rows[0].n;
  const result = (await inspectThroughMcp(ownerSession, {
    tool: "get_room_capacity",
  })) as { rooms: unknown[] };
  assert.equal(result.rooms.length, 2);
  assert.equal(
    (
      await pool().query(
        "SELECT count(*)::int AS n FROM assistant_capabilities",
      )
    ).rows[0].n,
    before,
  );
  assert.equal(
    (
      await pool().query(
        "SELECT status FROM assistant_runs WHERE message='Operator tool: get_room_capacity'",
      )
    ).rows[0].status,
    "complete",
  );
});
test("tool authorization is rechecked after a session or privilege is revoked", async () => {
  await pool().query("DELETE FROM sessions WHERE token_hash=$1", [
    digest(aliceSession),
  ]);
  await assert.rejects(
    () => resident.call("get_package_details", { parcel_id: parcelIds.ready }),
    /Unauthorized/,
  );
  await pool().query("UPDATE users SET role='resident' WHERE id=$1", [
    owner.id,
  ]);
  try {
    await assert.rejects(
      () => operator.call("get_room_capacity"),
      /Owner access/,
    );
  } finally {
    await pool().query("UPDATE users SET role='owner' WHERE id=$1", [owner.id]);
  }
  await pool().query(
    "UPDATE assistant_capabilities SET expires_at=now()-interval '1 second'",
  );
  await assert.rejects(
    () => operator.call("get_room_capacity"),
    /Unauthorized/,
  );
  await assert.rejects(
    () => callOperationTool("bad-token", "get_room_capacity", {}),
    /Unauthorized/,
  );
});
