import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { z } from "zod";
import { AppError, digest, type User } from "./auth.ts";
import { ensureSchema, pool, transaction } from "./db.ts";
import { parseDeliveryEmail, gmailBody } from "./mail-parser.ts";
import type pg from "pg";

export const MAIL_CONSENT_VERSION = "gmail-readonly-v1-2026-09-24";
const scope = "https://www.googleapis.com/auth/gmail.readonly";
type Connection = {
  user_id: string;
  mailbox: string;
  refresh_token_cipher: string;
  next_page_token: string | null;
  search_query: string | null;
};

function encryptionKey() {
  const hex = process.env.MAIL_TOKEN_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(hex))
    throw new AppError("Email connection is not configured yet.", 503);
  return Buffer.from(hex, "hex");
}
export function sealMailSecret(value: string, userId: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}
export function openMailSecret(value: string, userId: string) {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data)
    throw new AppError("Please reconnect your email.", 409);
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "hex"),
  );
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export function mailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    /^[a-f0-9]{64}$/i.test(process.env.MAIL_TOKEN_KEY || ""),
  );
}
export function mailOrigin() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new AppError("Email connection requires HTTPS.", 503);
  return url.origin;
}
function oauthClient() {
  if (!mailConfigured())
    throw new AppError(
      "Gmail is not configured yet. You can paste a delivery notice below.",
      503,
    );
  return new OAuth2Client({
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: `${mailOrigin()}/api/mail/callback`,
    transporterOptions: { timeout: 15000, retry: false },
  });
}
async function requireEligible(
  user: User,
  db: pg.Pool | pg.PoolClient = pool(),
) {
  const row = (
    await db.query("SELECT role,verified_at FROM users WHERE id=$1", [user.id])
  ).rows[0];
  if (!row || (row.role !== "owner" && !row.verified_at))
    throw new AppError(
      "Your residency must be approved before importing delivery notices.",
      403,
    );
}
export async function startMailConnection(
  user: User,
  sessionToken: string,
  confirmed: boolean,
) {
  await ensureSchema();
  await requireEligible(user);
  if (!confirmed)
    throw new AppError("Please review and accept the email connection notice.");
  const client = oauthClient();
  const { codeVerifier, codeChallenge } =
    await client.generateCodeVerifierAsync();
  const state = randomBytes(32).toString("hex"),
    browser = randomBytes(32).toString("hex");
  await transaction(async (db) => {
    await db.query(
      "DELETE FROM mail_oauth_states WHERE expires_at < now() OR user_id=$1",
      [user.id],
    );
    await db.query(
      "INSERT INTO mail_oauth_states VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')",
      [
        digest(state),
        user.id,
        digest(sessionToken),
        digest(browser),
        sealMailSecret(codeVerifier, user.id),
      ],
    );
  });
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: [scope],
    state,
    prompt: "consent",
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  return { url, browser };
}
// Single-use state plus a browser-bound Lax cookie allows an OAuth callback while
// the application session remains SameSite=Strict. The initiating session must
// still be valid. No user or session identifier is accepted from Google params.
export async function consumeMailState(
  state: string,
  browser: string,
  connection?: pg.PoolClient,
) {
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser))
    throw new AppError("Connection request expired. Please start again.", 400);
  const consume = async (db: pg.PoolClient) => {
    const row = (
      await db.query(
        `DELETE FROM mail_oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now()
      RETURNING *`,
        [digest(state), digest(browser)],
      )
    ).rows[0];
    if (!row)
      throw new AppError("Connection request expired. Please start again.");
    const user = (
      await db.query<User>(
        `SELECT u.id,u.email,u.name,u.unit,u.role,u.verified_at FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>now()`,
        [row.session_hash, row.user_id],
      )
    ).rows[0];
    if (!user) throw new AppError("Please sign in and connect again.", 401);
    await requireEligible(user, db);
    return {
      user,
      sessionHash: row.session_hash as string,
      verifier: openMailSecret(row.verifier_cipher, user.id),
    };
  };
  return connection ? consume(connection) : transaction(consume);
}
export async function completeMailConnection(
  code: string,
  state: string,
  browser: string,
  denied = false,
) {
  await transaction(async (db) => {
    // Serialize the entire completion against disconnect; a cancelled connection
    // cannot be recreated by an in-flight token exchange after disconnect returns.
    const pending = (
      await db.query(
        "SELECT user_id FROM mail_oauth_states WHERE state_hash=$1",
        [digest(state)],
      )
    ).rows[0];
    if (!pending)
      throw new AppError("Connection request expired. Please start again.");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `mail:${pending.user_id}`,
    ]);
    const { user, verifier, sessionHash } = await consumeMailState(
      state,
      browser,
      db,
    );
    if (denied) throw new AppError("Gmail connection was cancelled.");
    if (!code || code.length > 4096)
      throw new AppError("Invalid connection response.");
    const client = oauthClient();
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.scope?.split(" ").includes(scope) || !tokens.refresh_token)
      throw new AppError(
        "Read-only Gmail access was not granted. Please connect again.",
      );
    client.setCredentials(tokens);
    const response = await client.request<{ emailAddress: string }>({
      url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      timeout: 15000,
      retry: false,
    });
    const mailbox = z.email().parse(response.data.emailAddress).toLowerCase();
    await requireEligible(user, db);
    if (
      !(
        await db.query(
          "SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()",
          [sessionHash, user.id],
        )
      ).rowCount
    )
      throw new AppError("Please sign in and connect again.", 401);
    const existing = (
      await db.query("SELECT mailbox FROM mail_connections WHERE user_id=$1", [
        user.id,
      ])
    ).rows[0];
    if (existing && existing.mailbox !== mailbox)
      throw new AppError(
        "Disconnect your current mailbox before connecting a different one.",
        409,
      );
    await db.query(
      `INSERT INTO mail_connections(user_id,mailbox,refresh_token_cipher,consent_version) VALUES ($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET refresh_token_cipher=EXCLUDED.refresh_token_cipher,consent_version=EXCLUDED.consent_version,
      connected_at=now(),last_error=NULL,next_page_token=NULL,search_query=NULL`,
      [
        user.id,
        mailbox,
        sealMailSecret(tokens.refresh_token!, user.id),
        MAIL_CONSENT_VERSION,
      ],
    );
  });
}
export async function mailOverview(user: User) {
  await ensureSchema();
  await requireEligible(user);
  const [connections, deliveries] = await Promise.all([
    pool().query(
      "SELECT mailbox,connected_at,last_sync_at,last_error,(next_page_token IS NOT NULL) AS has_more FROM mail_connections WHERE user_id=$1",
      [user.id],
    ),
    pool().query(
      `SELECT d.id,d.carrier,d.tracking,d.created_at,
      e.email_claim,i.source,i.received_at FROM expected_deliveries d
      JOIN LATERAL (SELECT s.email_claim,s.import_id FROM expected_delivery_sources s JOIN mail_imports mi ON mi.id=s.import_id
        WHERE s.delivery_id=d.id ORDER BY mi.received_at DESC,mi.imported_at DESC LIMIT 1) e ON true
      JOIN mail_imports i ON i.id=e.import_id WHERE d.user_id=$1 ORDER BY i.received_at DESC LIMIT 100`,
      [user.id],
    ),
  ]);
  return {
    configured: mailConfigured(),
    connection: connections.rows[0] || null,
    deliveries: deliveries.rows,
    limit: 100,
  };
}
export async function importNotice(
  db: pg.PoolClient,
  userId: string,
  source: "gmail" | "paste",
  sourceKey: string,
  receivedAt: Date,
  subject: string,
  body: string,
) {
  const candidates = parseDeliveryEmail(subject, body);
  const inserted = await db.query(
    `INSERT INTO mail_imports(id,user_id,source,source_key,received_at) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT(user_id,source,source_key) DO NOTHING RETURNING id`,
    [randomUUID(), userId, source, sourceKey, receivedAt],
  );
  if (!inserted.rowCount) return { candidates: 0, duplicate: true };
  for (const c of candidates) {
    const row = (
      await db.query(
        `INSERT INTO expected_deliveries(id,user_id,carrier,tracking) VALUES ($1,$2,$3,$4)
      ON CONFLICT(user_id,carrier,tracking) DO UPDATE SET tracking=EXCLUDED.tracking RETURNING id`,
        [randomUUID(), userId, c.carrier, c.tracking],
      )
    ).rows[0];
    await db.query("INSERT INTO expected_delivery_sources VALUES ($1,$2,$3)", [
      row.id,
      inserted.rows[0].id,
      c.claim,
    ]);
  }
  // Subject, body, addresses and attachments are deliberately not persisted.
  return { candidates: candidates.length, duplicate: false };
}
export async function pasteNotice(user: User, raw: unknown) {
  const input = z
    .object({
      subject: z.string().trim().max(300).default(""),
      body: z.string().trim().min(10).max(12000),
      confirmed: z.literal(true),
    })
    .parse(raw);
  return transaction(async (db) => {
    await requireEligible(user, db);
    return importNotice(
      db,
      user.id,
      "paste",
      digest(`${input.subject}\n${input.body}`),
      new Date(),
      input.subject,
      input.body,
    );
  });
}
// A resident may use the complete physical-delivery service without ever
// connecting a mailbox or sharing the contents of an email.
export async function addExpectedDelivery(user: User, raw: unknown) {
  const input = z
    .object({
      carrier: z.enum([
        "Amazon",
        "UPS",
        "FedEx",
        "USPS",
        "DHL",
        "Walmart",
        "GOFO",
        "UniUni",
        "SwiftX",
        "Other",
      ]),
      tracking: z
        .string()
        .trim()
        .min(6)
        .max(80)
        .regex(/^[a-zA-Z0-9 -]+$/)
        .transform((value) => value.replace(/[ -]/g, "").toUpperCase())
        .pipe(z.string().min(6)),
    })
    .parse(raw);
  return transaction(async (db) => {
    await requireEligible(user, db);
    const sourceKey = digest(`${input.carrier}:${input.tracking}`);
    // An explicit manual action may restore a previously dismissed expectation.
    const imported = (
      await db.query(
        `INSERT INTO mail_imports(id,user_id,source,source_key,received_at) VALUES ($1,$2,'manual',$3,now())
      ON CONFLICT(user_id,source,source_key) DO UPDATE SET received_at=now() RETURNING id`,
        [randomUUID(), user.id, sourceKey],
      )
    ).rows[0];
    const delivery = (
      await db.query(
        `INSERT INTO expected_deliveries(id,user_id,carrier,tracking) VALUES ($1,$2,$3,$4)
      ON CONFLICT(user_id,carrier,tracking) DO UPDATE SET tracking=EXCLUDED.tracking RETURNING id`,
        [randomUUID(), user.id, input.carrier, input.tracking],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO expected_delivery_sources VALUES ($1,$2,'Mentioned') ON CONFLICT DO NOTHING",
      [delivery.id, imported.id],
    );
    return { ok: true, id: delivery.id };
  });
}
export async function syncGmail(user: User) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `mail:${user.id}`,
    ]);
    await requireEligible(user, db);
    const connection = (
      await db.query<Connection>(
        "SELECT * FROM mail_connections WHERE user_id=$1 FOR UPDATE",
        [user.id],
      )
    ).rows[0];
    if (!connection) throw new AppError("Connect Gmail first.", 409);
    const client = oauthClient();
    client.setCredentials({
      refresh_token: openMailSecret(connection.refresh_token_cipher, user.id),
    });
    const signal = AbortSignal.timeout(45000);
    const cutoff = Math.floor(Date.now() / 1000);
    const query =
      connection.next_page_token && connection.search_query
        ? connection.search_query
        : `after:${cutoff - 30 * 86400} before:${cutoff} {subject:shipped subject:delivery subject:delivered subject:tracking subject:shipment}`;
    const listed = await client.request<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>({
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      params: {
        q: query,
        maxResults: 20,
        ...(connection.next_page_token
          ? { pageToken: connection.next_page_token }
          : {}),
      },
      timeout: 15000,
      retry: false,
      signal,
    });
    let matched = 0,
      skipped = 0;
    for (const { id } of (listed.data.messages || []).slice(0, 20)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
      if (
        (
          await db.query(
            "SELECT 1 FROM mail_imports WHERE user_id=$1 AND source='gmail' AND source_key=$2",
            [user.id, id],
          )
        ).rowCount
      ) {
        skipped++;
        continue;
      }
      const response = await client.request<{
        internalDate: string;
        payload?: Parameters<typeof gmailBody>[0] & {
          headers?: { name: string; value: string }[];
        };
      }>({
        url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
        params: { format: "full" },
        timeout: 15000,
        retry: false,
        signal,
      });
      const message = response.data;
      const subject =
        message.payload?.headers?.find(
          (h) => h.name.toLowerCase() === "subject",
        )?.value || "";
      const timestamp = Number(message.internalDate);
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(new Date(timestamp).getTime())
      )
        continue;
      const result = await importNotice(
        db,
        user.id,
        "gmail",
        id,
        new Date(timestamp),
        subject,
        gmailBody(message.payload),
      );
      matched += result.candidates;
    }
    await db.query(
      "UPDATE mail_connections SET last_sync_at=now(),last_error=NULL,next_page_token=$2,search_query=$3 WHERE user_id=$1",
      [
        user.id,
        listed.data.nextPageToken || null,
        listed.data.nextPageToken ? query : null,
      ],
    );
    return {
      checked: listed.data.messages?.length || 0,
      matched,
      skipped,
      hasMore: Boolean(listed.data.nextPageToken),
    };
  });
}
export async function disconnectMail(user: User) {
  let encrypted: string | undefined;
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `mail:${user.id}`,
    ]);
    encrypted = (
      await db.query(
        "DELETE FROM mail_connections WHERE user_id=$1 RETURNING refresh_token_cipher",
        [user.id],
      )
    ).rows[0]?.refresh_token_cipher;
    await db.query("DELETE FROM mail_oauth_states WHERE user_id=$1", [user.id]);
    await db.query(
      "DELETE FROM mail_imports WHERE user_id=$1 AND source='gmail'",
      [user.id],
    );
    await db.query(
      "DELETE FROM expected_deliveries d WHERE user_id=$1 AND NOT EXISTS (SELECT 1 FROM expected_delivery_sources s WHERE s.delivery_id=d.id)",
      [user.id],
    );
  });
  let revoked = true;
  if (encrypted) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: openMailSecret(encrypted, user.id),
        }),
        signal: AbortSignal.timeout(10000),
      });
      revoked = response.ok;
    } catch {
      revoked = false;
    }
  }
  return { ok: true, revoked };
}
export async function forgetNotice(user: User, raw: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(raw);
  await ensureSchema();
  // Keep the processed-message tombstone so a subsequent sync does not recreate
  // a dismissed notice. A mailbox disconnect removes these tombstones as well.
  await pool().query(
    "DELETE FROM expected_deliveries WHERE id=$1 AND user_id=$2",
    [id, user.id],
  );
  return { ok: true };
}
