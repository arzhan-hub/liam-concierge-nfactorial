import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, ensureSchema } from "../src/lib/db.ts";
import {
  activate,
  token,
  currentUser,
  newSession,
  type User,
} from "../src/lib/auth.ts";
import {
  receiveParcel,
  inviteResident,
  dashboard,
  createWindow,
  scheduleDelivery,
  transitionParcel,
  saveMetrics,
} from "../src/lib/service.ts";
import {
  connectResidentIdentity,
  submitResidentProfile,
  approveResident,
} from "../src/lib/resident-accounts.ts";
import {
  firebasePublicConfig,
  verifyFirebaseIdentity,
} from "../src/lib/firebase-server.ts";

const original = process.env.DATABASE_URL!;
const schema = `liam_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: original });
const owner: User = {
  id: randomUUID(),
  email: "owner@example.com",
  name: "Test Owner",
  unit: null,
  role: "owner",
};
const alice: User = {
  id: randomUUID(),
  email: "alice@example.com",
  name: "Alice Example",
  unit: "1-101",
  role: "resident",
};
const bob: User = {
  id: randomUUID(),
  email: "bob@example.com",
  name: "Bob Example",
  unit: "2-202",
  role: "resident",
};
let count = 0;
function parcel(
  resident: User = alice,
  overrides: Record<string, unknown> = {},
) {
  return {
    tracking: `TEST${++count}`,
    carrier: "UPS",
    label_name: resident.name,
    label_unit: resident.unit,
    location: "A-02",
    resident_id: resident.id,
    condition: "Intact",
    weight_lbs: 5,
    exception_reason: "",
    safe_standard: true,
    ...overrides,
  };
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
      "INSERT INTO users (id,email,name,unit,role,verified_at) VALUES ($1,$2,$3,$4,$5,now())",
      [u.id, u.email, u.name, u.unit, u.role],
    );
});
after(async () => {
  await pool().end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  process.env.DATABASE_URL = original;
});

test("residents cannot perform intake or see another resident’s parcels", async () => {
  await assert.rejects(() => receiveParcel(alice, parcel()), /Owner access/);
  const received = await receiveParcel(owner, parcel(alice));
  assert.equal(
    (await dashboard(alice)).parcels.some((p) => p.id === received.id),
    true,
  );
  assert.equal(
    (await dashboard(bob)).parcels.some((p) => p.id === received.id),
    false,
  );
  assert.equal((await dashboard(bob)).residents.length, 0);
});
test("social registration requires separate residency verification and owner-only approval", async () => {
  const identity = {
    uid: randomUUID(),
    email: "new-social@example.com",
    name: "Social Test",
    provider: "google.com" as const,
  };
  const id = await connectResidentIdentity(identity);
  const resident: User = { id, ...identity, unit: null, role: "resident" };
  assert.equal(await connectResidentIdentity(identity), id);
  assert.equal((await dashboard(resident)).parcels.length, 0);
  assert.equal((await dashboard(resident)).windows.length, 0);
  await assert.rejects(() =>
    submitResidentProfile(resident, {
      name: "Social Test",
      unit: "1-707",
      confirmed: false,
    }),
  );
  await submitResidentProfile(resident, {
    name: "Social Test",
    unit: "1-707",
    confirmed: true,
  });
  assert.equal((await dashboard(resident)).user.verified_at, null);
  await assert.rejects(
    () => receiveParcel(owner, parcel({ ...resident, unit: "1-707" })),
    /verified/i,
  );
  await assert.rejects(
    () =>
      approveResident(resident, { id, note: "Self approved", confirmed: true }),
    /Owner access/,
  );
  await assert.rejects(
    () =>
      approveResident(owner, {
        id,
        name: "Social Test",
        unit: "1-999",
        note: "Stale profile",
        confirmed: true,
      }),
    /details changed/,
  );
  await approveResident(owner, {
    id,
    name: "Social Test",
    unit: "1-707",
    note: "Fictional rehearsal verification against the test roster.",
    confirmed: true,
  });
  assert.ok((await dashboard(resident)).user.verified_at);
  await assert.rejects(
    () =>
      submitResidentProfile(resident, {
        name: "Other",
        unit: "1-999",
        confirmed: true,
      }),
    /already verified/,
  );
  const record = await receiveParcel(
    owner,
    parcel({ ...resident, unit: "1-707" }),
  );
  assert.equal((await dashboard(resident)).parcels[0].id, record.id);
  await assert.rejects(
    () => pool().query("DELETE FROM account_events WHERE subject_id=$1", [id]),
    /append-only/,
  );
});
test("social linking never grants owner access or trusts matching email alone", async () => {
  await assert.rejects(
    () =>
      connectResidentIdentity({
        uid: randomUUID(),
        email: owner.email,
        name: owner.name,
        provider: "google.com",
      }),
    /owner sign-in/i,
  );
  const identity = {
    uid: randomUUID(),
    email: "link-test@example.com",
    name: "Link Test",
    provider: "apple.com" as const,
  };
  const input = {
    name: identity.name,
    email: identity.email,
    unit: "1-808",
    verified: true,
  };
  const invite = await inviteResident(owner, input);
  await assert.rejects(
    () => connectResidentIdentity(identity),
    /private invitation/,
  );
  const invitation = new URL(invite.url).hash.slice(1);
  const id = await connectResidentIdentity(identity, invitation);
  assert.ok(id);
  await assert.rejects(
    () =>
      connectResidentIdentity({ ...identity, uid: randomUUID() }, invitation),
    /different sign-in identity/,
  );
  await assert.rejects(
    () =>
      connectResidentIdentity(
        {
          ...identity,
          uid: randomUUID(),
          email: "relay@privaterelay.appleid.com",
        },
        invitation,
      ),
    /differs from/,
  );
});
test("Firebase config exposes only public identifiers and fabricated tokens fail closed", async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      FIREBASE_AUTH_ENABLED: "true",
      FIREBASE_GOOGLE_ENABLED: "true",
      FIREBASE_PROJECT_ID: "liam-auth-test",
      FIREBASE_WEB_API_KEY: "public-test-key",
      FIREBASE_WEB_APP_ID: "public-app",
      FIREBASE_AUTH_DOMAIN: "liam-auth-test.firebaseapp.com",
    });
    assert.deepEqual(Object.keys(firebasePublicConfig()).sort(), [
      "apple",
      "config",
      "configured",
      "google",
    ]);
    assert.equal(
      JSON.stringify(firebasePublicConfig()).includes(
        process.env.SETUP_TOKEN || "secret-not-present",
      ),
      false,
    );
    await assert.rejects(
      () => verifyFirebaseIdentity("invalid-token-not-a-firebase-jwt"),
      /could not be verified/,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
test("unit conflicts, unsafe weights and duplicate tracking numbers are rejected", async () => {
  await assert.rejects(
    () => receiveParcel(owner, parcel(alice, { label_unit: "WRONG" })),
    /conflicts/,
  );
  await assert.rejects(() =>
    receiveParcel(owner, parcel(alice, { weight_lbs: 26 })),
  );
  await assert.rejects(() =>
    receiveParcel(owner, parcel(alice, { safe_standard: false })),
  );
  const input = parcel();
  await receiveParcel(owner, input);
  await assert.rejects(() => receiveParcel(owner, input), { code: "23505" });
});
test("damaged parcels stay in review until an owner records a verified resolution", async () => {
  const { id } = await receiveParcel(
    owner,
    parcel(alice, { condition: "Visible damage" }),
  );
  assert.equal(
    (await pool().query("SELECT status FROM parcels WHERE id=$1", [id])).rows[0]
      .status,
    "Needs review",
  );
  await assert.rejects(
    () =>
      transitionParcel(owner, {
        id,
        action: "resolve",
        resident_id: alice.id,
        location: "A-02",
        note: "",
      }),
    /Confirm/,
  );
  await transitionParcel(owner, {
    id,
    action: "resolve",
    resident_id: alice.id,
    location: "A-03",
    note: "Resident confirmed identity and acknowledged exterior damage; safe to release.",
    confirmed: true,
  });
  assert.equal(
    (await pool().query("SELECT status FROM parcels WHERE id=$1", [id])).rows[0]
      .status,
    "Ready",
  );
});
test("concurrent requests cannot oversubscribe the final stop", async () => {
  const starts = new Date(Date.now() + 2 * 86400000).toISOString();
  await createWindow(owner, { starts_at: starts, capacity: 1 });
  const w = (
    await pool().query("SELECT id FROM delivery_windows WHERE starts_at=$1", [
      starts,
    ])
  ).rows[0];
  const a = await receiveParcel(owner, parcel(alice)),
    b = await receiveParcel(owner, parcel(bob));
  const results = await Promise.allSettled([
    scheduleDelivery(alice, { parcel_id: a.id, window_id: w.id }),
    scheduleDelivery(bob, { parcel_id: b.id, window_id: w.id }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await pool().query(
        "SELECT count(*)::int AS n FROM parcels WHERE window_id=$1 AND status='Scheduled'",
        [w.id],
      )
    ).rows[0].n,
    1,
  );
});
test("a resident cannot schedule or cancel another person’s parcel", async () => {
  const a = await receiveParcel(owner, parcel(alice));
  const w = (await pool().query("SELECT id FROM delivery_windows LIMIT 1"))
    .rows[0];
  await assert.rejects(
    () => scheduleDelivery(bob, { parcel_id: a.id, window_id: w.id }),
    /not found/,
  );
  await assert.rejects(
    () => transitionParcel(bob, { id: a.id, action: "cancel" }),
    /not found/,
  );
});
test("tracking and destination checks prevent invalid handoffs; event history is append-only", async () => {
  const starts = new Date(Date.now() + 3 * 86400000).toISOString();
  await createWindow(owner, { starts_at: starts, capacity: 4 });
  const w = (
    await pool().query("SELECT id FROM delivery_windows WHERE starts_at=$1", [
      starts,
    ])
  ).rows[0];
  const input = parcel(alice),
    p = await receiveParcel(owner, input);
  await scheduleDelivery(alice, { parcel_id: p.id, window_id: w.id });
  await assert.rejects(
    () =>
      transitionParcel(owner, {
        id: p.id,
        action: "deliver",
        tracking: input.tracking,
        unit: alice.unit,
        confirmed: true,
      }),
    /changed/,
  );
  await assert.rejects(
    () =>
      transitionParcel(owner, {
        id: p.id,
        action: "load",
        tracking: "WRONG",
        confirmed: true,
      }),
    /does not match/,
  );
  await transitionParcel(owner, {
    id: p.id,
    action: "load",
    tracking: input.tracking,
    confirmed: true,
  });
  await assert.rejects(
    () =>
      transitionParcel(owner, {
        id: p.id,
        action: "deliver",
        tracking: input.tracking,
        unit: bob.unit,
        confirmed: true,
      }),
    /Unit does not match/,
  );
  await assert.rejects(
    () =>
      transitionParcel(alice, {
        id: p.id,
        action: "deliver",
        tracking: input.tracking,
        unit: alice.unit,
        confirmed: true,
      }),
    /Owner access/,
  );
  await transitionParcel(owner, {
    id: p.id,
    action: "deliver",
    tracking: input.tracking,
    unit: alice.unit,
    confirmed: true,
  });
  const events = (
    await pool().query(
      "SELECT * FROM events WHERE parcel_id=$1 ORDER BY created_at",
      [p.id],
    )
  ).rows;
  assert.deepEqual(
    events.map((e) => e.to_status),
    ["Ready", "Scheduled", "Out for delivery", "Delivered"],
  );
  await assert.rejects(
    () =>
      pool().query("UPDATE events SET note='overwritten' WHERE id=$1", [
        events[0].id,
      ]),
    /append-only/,
  );
});
test("invitations are single use, hashed sessions expire, and owner setup cannot run twice", async () => {
  const invitation = await inviteResident(owner, {
    email: "new@example.com",
    name: "New Resident",
    unit: "3-303",
    verified: true,
  });
  const raw = invitation.url.split("#")[1];
  const input = {
    token: raw,
    email: "new@example.com",
    name: "New Resident",
    password: "a-long-test-password",
  };
  const id = await activate(input);
  await assert.rejects(() => activate(input), /invalid/);
  const session = await newSession(id);
  assert.equal((await currentUser(session))?.id, id);
  assert.equal(
    (
      await pool().query("SELECT token_hash FROM sessions WHERE user_id=$1", [
        id,
      ])
    ).rows[0].token_hash === session,
    false,
  );
  await pool().query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [id],
  );
  assert.equal(await currentUser(session), null);
  process.env.SETUP_TOKEN = token();
  await assert.rejects(
    () => activate({ ...input, token: process.env.SETUP_TOKEN! }),
    /invalid/,
  );
});
test("daily workload is stored as one replaceable total, not double counted", async () => {
  const input = {
    day: "2026-09-01",
    minutes: 120,
    interruptions: 2,
    search_seconds: 25,
    note: "Baseline",
  };
  await saveMetrics(owner, input);
  await saveMetrics(owner, { ...input, minutes: 190 });
  const rows = (await dashboard(owner)).metrics;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].minutes, 190);
});
