import { randomUUID } from "node:crypto";
import { AppError, digest, type User } from "./auth.ts";
import type { FirebaseIdentity } from "./firebase-server.ts";
import { transaction } from "./db.ts";
import { residentProfile, residentApproval } from "./validation.ts";

// Called only after the server verifies a Firebase token; no route accepts an identity object.
export async function connectResidentIdentity(
  identity: FirebaseIdentity,
  invitation?: string,
) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      identity.uid,
    ]);
    const linked = (
      await db.query("SELECT * FROM users WHERE firebase_uid=$1 FOR UPDATE", [
        identity.uid,
      ])
    ).rows[0];
    if (linked) {
      if (linked.role !== "resident")
        throw new AppError("Use the owner sign-in for this account.", 403);
      return linked.id as string;
    }
    const existing = (
      await db.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [
        identity.email,
      ])
    ).rows[0];
    if (existing) {
      if (existing.role !== "resident")
        throw new AppError("Use the owner sign-in for this account.", 403);
      if (existing.firebase_uid)
        throw new AppError(
          "This resident account uses a different sign-in identity. Use the original sign-in method.",
          409,
        );
      // Matching email alone never links a pre-existing local account.
      const invite = invitation
        ? (
            await db.query(
              "SELECT * FROM invitations WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
              [digest(invitation), existing.id],
            )
          ).rows[0]
        : null;
      if (!invite)
        throw new AppError(
          "An account already exists for this email. Open a new private invitation from the operator to connect your sign-in.",
          409,
        );
      await db.query("UPDATE users SET firebase_uid=$1 WHERE id=$2", [
        identity.uid,
        existing.id,
      ]);
      await db.query(
        "UPDATE invitations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [existing.id],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [existing.id]);
      await db.query(
        "INSERT INTO account_events(id,subject_id,actor_id,event_type,note) VALUES ($1,$2,$2,'social_linked',$3)",
        [
          randomUUID(),
          existing.id,
          `Explicit account-link consent v1; ${identity.provider}; private invitation verified.`,
        ],
      );
      return existing.id as string;
    }
    if (invitation)
      throw new AppError(
        "The sign-in email differs from the invitation email. Sign in without the invitation to request separate residency verification, or use the invited email.",
        409,
      );
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,role,firebase_uid) VALUES ($1,$2,$3,'resident',$4)",
      [id, identity.email, identity.name, identity.uid],
    );
    await db.query(
      "INSERT INTO account_events(id,subject_id,actor_id,event_type,note) VALUES ($1,$2,$2,'social_registered',$3)",
      [
        randomUUID(),
        id,
        `Explicit account-link consent v1; ${identity.provider}. Residency remains unverified.`,
      ],
    );
    return id;
  });
}
export async function submitResidentProfile(user: User, raw: unknown) {
  if (user.role !== "resident")
    throw new AppError("Resident access required.", 403);
  const input = residentProfile.parse(raw);
  return transaction(async (db) => {
    const resident = (
      await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [user.id])
    ).rows[0];
    if (resident.verified_at)
      throw new AppError(
        "Your residency is already verified. Ask the operator to update your unit.",
        409,
      );
    await db.query(
      "UPDATE users SET name=$1,unit=$2,profile_submitted_at=now() WHERE id=$3",
      [input.name, input.unit, user.id],
    );
    await db.query(
      "INSERT INTO account_events(id,subject_id,actor_id,event_type,note) VALUES ($1,$2,$2,'profile_submitted',$3)",
      [
        randomUUID(),
        user.id,
        `Resident confirmed ${input.name}, unit ${input.unit}. Awaiting independent verification.`,
      ],
    );
    return {};
  });
}
export async function approveResident(user: User, raw: unknown) {
  if (user.role !== "owner") throw new AppError("Owner access required.", 403);
  const input = residentApproval.parse(raw);
  return transaction(async (db) => {
    const resident = (
      await db.query(
        "SELECT * FROM users WHERE id=$1 AND role='resident' FOR UPDATE",
        [input.id],
      )
    ).rows[0];
    if (!resident?.profile_submitted_at || !resident.unit)
      throw new AppError("The resident must submit their name and unit first.");
    if (resident.verified_at)
      throw new AppError("This resident is already verified.", 409);
    if (resident.name !== input.name || resident.unit !== input.unit)
      throw new AppError(
        "The resident details changed. Refresh and verify the updated details before approving.",
        409,
      );
    await db.query("UPDATE users SET verified_at=now() WHERE id=$1", [
      input.id,
    ]);
    await db.query(
      "INSERT INTO account_events(id,subject_id,actor_id,event_type,note) VALUES ($1,$2,$3,'residency_verified',$4)",
      [randomUUID(), input.id, user.id, input.note],
    );
    return {};
  });
}
