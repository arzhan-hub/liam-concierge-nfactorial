import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { pool, ensureSchema, transaction } from "./db.ts";

const derive = promisify(scrypt);
export type User = {
  id: string;
  email: string;
  name: string;
  unit: string | null;
  role: "owner" | "resident";
  verified_at?: Date | null;
  profile_submitted_at?: Date | null;
};
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const token = () => randomBytes(32).toString("hex");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  const calculated = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, "hex");
  return (
    calculated.length === expected.length &&
    timingSafeEqual(calculated, expected)
  );
}
export async function currentUser(rawToken?: string): Promise<User | null> {
  if (!rawToken) return null;
  await ensureSchema();
  return (
    (
      await pool().query<User>(
        `SELECT u.id,u.name,u.email,u.unit,u.role,u.verified_at,u.profile_submitted_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at > now()`,
        [digest(rawToken)],
      )
    ).rows[0] ?? null
  );
}
export async function newSession(
  userId: string,
  lifetimeSeconds = 12 * 60 * 60,
) {
  if (
    !Number.isInteger(lifetimeSeconds) ||
    lifetimeSeconds < 1 ||
    lifetimeSeconds > 12 * 60 * 60
  )
    throw new AppError("Invalid session lifetime.");
  const raw = token();
  await pool().query("DELETE FROM sessions WHERE expires_at < now()");
  await pool().query(
    "INSERT INTO sessions VALUES ($1,$2,now()+$3*interval '1 second')",
    [digest(raw), userId, lifetimeSeconds],
  );
  return raw;
}
export async function rateLimit(key: string, maximum = 10) {
  await ensureSchema();
  const result = await pool().query(
    `INSERT INTO login_limits VALUES ($1,1,now()+interval '15 minutes')
    ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN login_limits.resets_at < now() THEN 1 ELSE login_limits.attempts+1 END,
    resets_at=CASE WHEN login_limits.resets_at < now() THEN now()+interval '15 minutes' ELSE login_limits.resets_at END RETURNING attempts`,
    [digest(key)],
  );
  if (result.rows[0].attempts > maximum)
    throw new AppError("Too many attempts. Please wait 15 minutes.", 429);
}
export async function activate(input: {
  token: string;
  email: string;
  name: string;
  password: string;
}) {
  const hash = await hashPassword(input.password);
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(810210)");
    const hasOwner = (await db.query("SELECT id FROM users WHERE role='owner'"))
      .rowCount;
    if (
      !hasOwner &&
      process.env.SETUP_TOKEN &&
      digest(input.token) === digest(process.env.SETUP_TOKEN)
    ) {
      const id = randomUUID();
      await db.query(
        "INSERT INTO users (id,email,name,role,password_hash,verified_at) VALUES ($1,$2,$3,'owner',$4,now())",
        [id, input.email, input.name, hash],
      );
      return id;
    }
    const invite = (
      await db.query(
        `SELECT i.*,u.email FROM invitations i JOIN users u ON u.id=i.user_id
      WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE OF i`,
        [digest(input.token)],
      )
    ).rows[0];
    if (!invite || invite.email !== input.email)
      throw new AppError(
        "This invitation is invalid, expired, or belongs to another email address.",
      );
    await db.query(
      "UPDATE users SET password_hash=$1,name=CASE WHEN verified_at IS NULL THEN $2 ELSE name END WHERE id=$3",
      [hash, input.name, invite.user_id],
    );
    await db.query(
      "UPDATE invitations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [invite.user_id],
    );
    await db.query("DELETE FROM sessions WHERE user_id=$1", [invite.user_id]);
    return invite.user_id as string;
  });
}
