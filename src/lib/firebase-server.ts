import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { AppError } from "./auth.ts";

export function firebasePublicConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const appId = process.env.FIREBASE_WEB_APP_ID;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const configured =
    process.env.FIREBASE_AUTH_ENABLED === "true" &&
    Boolean(projectId && apiKey && appId && authDomain);
  return {
    configured,
    google: configured && process.env.FIREBASE_GOOGLE_ENABLED === "true",
    apple: configured && process.env.FIREBASE_APPLE_ENABLED === "true",
    // Only these public SDK identifiers may leave the server. Never return credentials.
    config: configured ? { projectId, apiKey, appId, authDomain } : null,
  };
}
export type FirebaseIdentity = {
  uid: string;
  email: string;
  name: string;
  provider: "google.com" | "apple.com";
  expiresAt?: number;
};
export async function verifyFirebaseIdentity(
  rawToken: string,
): Promise<FirebaseIdentity> {
  const settings = firebasePublicConfig();
  if (!settings.configured)
    throw new AppError("Social sign-in is not available yet.", 503);
  // Emulator acceptance is deliberately absent from the live server boundary.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new AppError(
      "The authentication emulator is not allowed by this server.",
      503,
    );
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const appName = `liam-auth-${projectId}`;
  const app =
    getApps().find((a) => a.name === appName) ??
    initializeApp({ projectId }, appName);
  let claims;
  // Signature, issuer, audience, expiry; revocation is checked by self-account lookup below.
  try {
    claims = await getAuth(app).verifyIdToken(rawToken);
  } catch {
    throw new AppError(
      "Your sign-in could not be verified. Please sign in again.",
      401,
    );
  }
  const provider = claims.firebase?.sign_in_provider;
  if (!(
    (provider === "google.com" && settings.google) ||
    (provider === "apple.com" && settings.apple)
  ))
    throw new AppError("This sign-in provider is not enabled.", 403);
  if (!claims.email_verified || typeof claims.email !== "string")
    throw new AppError("A verified sign-in email is required.", 403);
  const age = Date.now() / 1000 - claims.auth_time;
  if (age > 300 || age < -60)
    throw new AppError("Please sign in again to start a fresh session.", 401);
  let response: Response;
  try {
    // Official end-user lookup: no CLI token, privileged account key or refresh token stored.
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(process.env.FIREBASE_WEB_API_KEY!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: rawToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw new AppError(
      "Sign-in verification is temporarily unavailable. Please try again.",
      503,
    );
  }
  if (!response.ok)
    throw new AppError(
      "Your account could not be verified. Please sign in again.",
      response.status >= 500 || response.status === 429 ? 503 : 401,
    );
  const account = (await response.json()).users?.[0];
  const validSince = Number(account?.validSince);
  if (
    !account ||
    account.localId !== claims.uid ||
    account.disabled === true ||
    account.emailVerified !== true ||
    account.email?.toLowerCase() !== claims.email.toLowerCase() ||
    !Number.isFinite(validSince) ||
    claims.auth_time < validSince
  )
    throw new AppError(
      "Your sign-in is no longer valid. Please sign in again.",
      401,
    );
  return {
    uid: claims.uid,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "",
    provider: provider as FirebaseIdentity["provider"],
    expiresAt: claims.exp,
  };
}
