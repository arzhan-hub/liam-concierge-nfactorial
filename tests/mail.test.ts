import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { OAuth2Client } from "google-auth-library";
import { pool, ensureSchema, transaction } from "../src/lib/db.ts";
import { newSession, digest, type User } from "../src/lib/auth.ts";
import { parseDeliveryEmail, gmailBody } from "../src/lib/mail-parser.ts";
import {
  sealMailSecret,
  openMailSecret,
  startMailConnection,
  consumeMailState,
  completeMailConnection,
  pasteNotice,
  importNotice,
  addExpectedDelivery,
  mailOverview,
  syncGmail,
  disconnectMail,
  forgetNotice,
} from "../src/lib/mail.ts";

const original = process.env.DATABASE_URL!;
const schema = `liam_mail_test_${randomBytes(8).toString("hex")}`;
const admin = new pg.Client({ connectionString: original });
const alice: User = {
  id: randomUUID(),
  email: "mail-alice@example.com",
  name: "Alice Test",
  unit: "1-101",
  role: "resident",
};
const bob: User = {
  id: randomUUID(),
  email: "mail-bob@example.com",
  name: "Bob Test",
  unit: "2-202",
  role: "resident",
};
const pending: User = {
  id: randomUUID(),
  email: "pending@example.com",
  name: "Pending Test",
  unit: null,
  role: "resident",
};
const track = "TBA123456789012";
const notice = {
  subject: "Your delivery",
  body: `Your package has shipped. Tracking: ${track}`,
  confirmed: true,
};
before(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.MAIL_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.GMAIL_CLIENT_ID = "fixture.apps.googleusercontent.com";
  process.env.GMAIL_CLIENT_SECRET = "fixture-not-a-real-secret";
  await ensureSchema();
  for (const user of [alice, bob, pending])
    await pool().query(
      "INSERT INTO users(id,email,name,unit,role,verified_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        user.id,
        user.email,
        user.name,
        user.unit,
        user.role,
        user === pending ? null : new Date(),
      ],
    );
});
after(async () => {
  mock.restoreAll();
  await pool().end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

for (const [name, body, expected] of [
  [
    "Amazon",
    `Your package was delivered. ${track}`,
    [{ carrier: "Amazon", tracking: track, claim: "Reported delivered" }],
  ],
  [
    "UPS",
    "Out for delivery 1Z999AA10123456784",
    [
      {
        carrier: "UPS",
        tracking: "1Z999AA10123456784",
        claim: "Out for delivery",
      },
    ],
  ],
  [
    "FedEx",
    "FedEx has shipped. Tracking number: 1234 5678 9012",
    [{ carrier: "FedEx", tracking: "123456789012", claim: "Shipped" }],
  ],
  [
    "DHL",
    "DHL tracking: 1234567890",
    [{ carrier: "DHL", tracking: "1234567890", claim: "Mentioned" }],
  ],
  [
    "USPS",
    "USPS Tracking # 9400 1000 0000 0000 0000 00",
    [
      {
        carrier: "USPS",
        tracking: "9400100000000000000000",
        claim: "Mentioned",
      },
    ],
  ],
  [
    "order numbers",
    "Amazon order 112-1234567-1234567. Phone 2015551234, Apt 1-204",
    [],
  ],
  ["unlabelled numeric", "FedEx 123456789012", []],
  ["unknown carrier", "Tracking 123456789012", []],
  [
    "negative delivery",
    `Your package is not delivered. ${track}`,
    [{ carrier: "Amazon", tracking: track, claim: "Mentioned" }],
  ],
  [
    "future delivery",
    `Your package will be delivered today. ${track}`,
    [{ carrier: "Amazon", tracking: track, claim: "Mentioned" }],
  ],
  [
    "negative shipped",
    `Not yet shipped. ${track}`,
    [{ carrier: "Amazon", tracking: track, claim: "Mentioned" }],
  ],
  ["script ignored", `<script>Tracking: ${track}</script><p>Order 123</p>`, []],
] as const)
  test(`mail parser: ${name}`, () =>
    assert.deepEqual(parseDeliveryEmail("", body), expected));

test("mixed shipments do not inherit an ambiguous delivered claim", () => {
  const candidates = parseDeliveryEmail(
    "Delivered and shipped",
    `Package delivered ${track}. Still pending 1Z999AA10123456784.`,
  );
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.claim === "Mentioned"));
});
test("MIME decoding reads inline text but excludes attachments and bounds output", () => {
  const encode = (s: string) => Buffer.from(s).toString("base64url");
  assert.equal(
    gmailBody({
      parts: [
        { mimeType: "text/plain", body: { data: encode("Visible") } },
        {
          filename: "private.txt",
          mimeType: "text/plain",
          body: { data: encode("Secret") },
        },
      ],
    }).trim(),
    "Visible",
  );
  assert.ok(
    gmailBody({
      mimeType: "text/html",
      body: { data: encode("a".repeat(100000)) },
    }).length <= 60000,
  );
});
test("tokens are authenticated, encrypted and bound to their owner", () => {
  const value = sealMailSecret("fixture-refresh-token", alice.id);
  assert.ok(!value.includes("fixture-refresh-token"));
  assert.equal(openMailSecret(value, alice.id), "fixture-refresh-token");
  assert.throws(() => openMailSecret(value, bob.id));
  assert.throws(() => openMailSecret(value.slice(0, -2) + "ff", alice.id));
  assert.notEqual(value, sealMailSecret("fixture-refresh-token", alice.id));
});
test("mail imports require consent and approved residency", async () => {
  await assert.rejects(() =>
    pasteNotice(alice, { ...notice, confirmed: false }),
  );
  await assert.rejects(() => pasteNotice(pending, notice), /residency/);
  await assert.rejects(
    () => startMailConnection(alice, "irrelevant", false),
    /accept/,
  );
});
test("imports deduplicate, stay private and never create physical parcels", async () => {
  assert.equal((await pasteNotice(alice, notice)).candidates, 1);
  assert.equal((await pasteNotice(alice, notice)).duplicate, true);
  assert.equal((await mailOverview(alice)).deliveries.length, 1);
  assert.equal((await mailOverview(bob)).deliveries.length, 0);
  assert.equal((await pool().query("SELECT * FROM parcels")).rowCount, 0);
  const columns = (
    await pool().query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='mail_imports'",
      [schema],
    )
  ).rows.map((r) => r.column_name);
  assert.ok(!columns.includes("body") && !columns.includes("subject"));
});
test("OAuth uses PKCE, correct redirect, browser binding and single-use state", async () => {
  const session = await newSession(alice.id);
  const result = await startMailConnection(alice, session, true);
  const url = new URL(result.url),
    state = url.searchParams.get("state")!;
  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/gmail.readonly",
  );
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${process.env.APP_URL}/api/mail/callback`,
  );
  await assert.rejects(
    () => consumeMailState(state, randomBytes(32).toString("hex")),
    /expired/,
  );
  assert.equal(
    (await consumeMailState(state, result.browser)).user.id,
    alice.id,
  );
  await assert.rejects(
    () => consumeMailState(state, result.browser),
    /expired/,
  );
});
test("logging out invalidates an outstanding OAuth flow", async () => {
  const session = await newSession(alice.id),
    result = await startMailConnection(alice, session, true);
  await pool().query("DELETE FROM sessions WHERE token_hash=$1", [
    digest(session),
  ]);
  await assert.rejects(
    () =>
      consumeMailState(
        new URL(result.url).searchParams.get("state")!,
        result.browser,
      ),
    /sign in/,
  );
});
test("OAuth token exchange, paginated sync and disconnect with mocked Google", async () => {
  const tokenMock = mock.method(
    OAuth2Client.prototype,
    "getToken",
    async () => ({
      tokens: {
        refresh_token: "test-refresh",
        access_token: "test-access",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    }),
  );
  let pageNumber = 0;
  const requestMock = mock.method(
    OAuth2Client.prototype,
    "request",
    async (options: { url: string; params?: Record<string, unknown> }) => {
      if (options.url.endsWith("/profile"))
        return { data: { emailAddress: "mail-alice@example.com" } };
      if (options.url.endsWith("/messages")) {
        assert.ok(String(options.params?.q).includes("subject:delivery"));
        if (pageNumber++ === 0)
          return {
            data: { messages: [{ id: "fixture1" }], nextPageToken: "page2" },
          };
        assert.equal(options.params?.pageToken, "page2");
        return { data: { messages: [{ id: "fixture1" }, { id: "fixture2" }] } };
      }
      return {
        data: {
          internalDate: String(Date.now()),
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "Subject", value: "Your delivery" }],
            body: {
              data: Buffer.from(
                `Your package was delivered. ${track}`,
              ).toString("base64url"),
            },
          },
        },
      };
    },
  );
  const revokeMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 200 }),
  );
  try {
    const session = await newSession(alice.id),
      result = await startMailConnection(alice, session, true);
    await completeMailConnection(
      "fixture-code",
      new URL(result.url).searchParams.get("state")!,
      result.browser,
    );
    const connection = (
      await pool().query("SELECT * FROM mail_connections WHERE user_id=$1", [
        alice.id,
      ])
    ).rows[0];
    assert.notEqual(connection.refresh_token_cipher, "test-refresh");
    assert.deepEqual(await syncGmail(alice), {
      checked: 1,
      matched: 1,
      skipped: 0,
      hasMore: true,
    });
    assert.deepEqual(await syncGmail(alice), {
      checked: 2,
      matched: 1,
      skipped: 1,
      hasMore: false,
    });
    assert.equal((await mailOverview(alice)).deliveries.length, 1);
    assert.equal(
      (await mailOverview(alice)).deliveries[0].email_claim,
      "Reported delivered",
    );
    assert.equal((await pool().query("SELECT * FROM parcels")).rowCount, 0);
    assert.equal((await disconnectMail(alice)).revoked, true);
    assert.equal((await mailOverview(alice)).connection, null);
    assert.equal((await mailOverview(alice)).deliveries[0].source, "paste");
    assert.equal(revokeMock.mock.callCount(), 1);
  } finally {
    tokenMock.mock.restore();
    requestMock.mock.restore();
    revokeMock.mock.restore();
  }
});
test("failed sync rolls back partial imports and cursor", async () => {
  await pool().query(
    "INSERT INTO mail_connections(user_id,mailbox,refresh_token_cipher,consent_version) VALUES ($1,$2,$3,'test')",
    [bob.id, bob.email, sealMailSecret("test", bob.id)],
  );
  const requestMock = mock.method(
    OAuth2Client.prototype,
    "request",
    async (options: { url: string }) => {
      if (options.url.endsWith("/messages"))
        return {
          data: {
            messages: [{ id: "rollback1" }, { id: "rollback2" }],
            nextPageToken: "later",
          },
        };
      if (options.url.endsWith("rollback2"))
        throw new Error("Simulated provider failure");
      return {
        data: {
          internalDate: String(Date.now()),
          payload: {
            mimeType: "text/plain",
            body: { data: Buffer.from(track).toString("base64url") },
          },
        },
      };
    },
  );
  try {
    await assert.rejects(() => syncGmail(bob), /Simulated/);
    assert.equal((await mailOverview(bob)).deliveries.length, 0);
    assert.equal(
      (
        await pool().query(
          "SELECT next_page_token FROM mail_connections WHERE user_id=$1",
          [bob.id],
        )
      ).rows[0].next_page_token,
      null,
    );
  } finally {
    requestMock.mock.restore();
  }
});
test("forget is owner-scoped and a repeated message cannot recreate a removed notice", async () => {
  const id = (await mailOverview(alice)).deliveries[0].id;
  await forgetNotice(bob, { id });
  assert.equal((await mailOverview(alice)).deliveries.length, 1);
  await forgetNotice(alice, { id });
  assert.equal((await mailOverview(alice)).deliveries.length, 0);
  assert.equal((await pasteNotice(alice, notice)).duplicate, true);
  assert.equal((await mailOverview(alice)).deliveries.length, 0);
});
test("Gmail-only notices are removed at disconnect, without affecting other users", async () => {
  await transaction((db) =>
    importNotice(db, alice.id, "gmail", "only-gmail", new Date(), "", track),
  );
  await transaction((db) =>
    importNotice(db, bob.id, "paste", "only-bob", new Date(), "", track),
  );
  await disconnectMail(alice);
  assert.equal((await mailOverview(alice)).deliveries.length, 0);
  assert.equal((await mailOverview(bob)).deliveries.length, 1);
});
test("manual expected packages need no Gmail credentials and survive disconnect", async () => {
  const beforeId = process.env.GMAIL_CLIENT_ID;
  delete process.env.GMAIL_CLIENT_ID;
  try {
    await assert.rejects(
      () =>
        addExpectedDelivery(pending, {
          carrier: "UPS",
          tracking: "TEST-123456",
        }),
      /residency/,
    );
    const first = await addExpectedDelivery(alice, {
      carrier: "UPS",
      tracking: "manual-123456",
    });
    const repeat = await addExpectedDelivery(alice, {
      carrier: "UPS",
      tracking: "MANUAL123456",
    });
    assert.equal(first.id, repeat.id);
    assert.equal((await mailOverview(alice)).deliveries[0].source, "manual");
    assert.equal((await mailOverview(alice)).connection, null);
    await disconnectMail(alice);
    assert.equal((await mailOverview(alice)).deliveries.length, 1);
    assert.equal((await pool().query("SELECT * FROM parcels")).rowCount, 0);
    await forgetNotice(alice, { id: first.id });
    await addExpectedDelivery(alice, {
      carrier: "UPS",
      tracking: "MANUAL123456",
    });
    assert.equal((await mailOverview(alice)).deliveries.length, 1);
  } finally {
    process.env.GMAIL_CLIENT_ID = beforeId;
  }
});
