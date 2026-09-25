import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  currentUser,
  AppError,
  activate,
  checkPassword,
  newSession,
  rateLimit,
  digest,
} from "@/lib/auth";
import { pool, ensureSchema } from "@/lib/db";
import { activation, credentials, firebaseSignIn } from "@/lib/validation";
import {
  firebasePublicConfig,
  verifyFirebaseIdentity,
} from "@/lib/firebase-server";
import {
  connectResidentIdentity,
  submitResidentProfile,
  approveResident,
} from "@/lib/resident-accounts";
import * as service from "@/lib/service";
import { recordRoomInspection } from "@/lib/operations";
import { inspectThroughMcp } from "@/lib/operations-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "liam_session";
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context) {
  try {
    const path = (await context.params).path.join("/");
    const mutation = request.method === "POST";
    if (mutation) {
      const origin = new URL(process.env.APP_URL || "http://localhost:3000")
        .origin;
      if (request.headers.get("origin") !== origin)
        throw new AppError("Request origin is not allowed.", 403);
      if (
        !(request.headers.get("content-type") || "").startsWith(
          "application/json",
        )
      )
        throw new AppError("JSON body required.", 415);
    }
    if (!mutation && path === "auth-config")
      return respond(firebasePublicConfig());
    await ensureSchema();
    let body: unknown = {};
    if (mutation) {
      const text = await request.text();
      if (Buffer.byteLength(text) > 16000)
        throw new AppError("Request is too large.", 413);
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError("Invalid JSON request.");
      }
    }
    if (mutation && ["login", "activate", "firebase-session"].includes(path)) {
      // Database-backed global throttle protects password hashing across processes.
      await rateLimit("auth:global", 100);
      let userId: string;
      let lifetimeSeconds = 12 * 60 * 60;
      if (path === "firebase-session") {
        const input = firebaseSignIn.parse(body);
        const identity = await verifyFirebaseIdentity(input.idToken);
        lifetimeSeconds = Math.min(
          3600,
          Math.floor(identity.expiresAt! - Date.now() / 1000),
        );
        if (lifetimeSeconds < 1)
          throw new AppError("Your sign-in expired. Please try again.", 401);
        await rateLimit(`firebase:${identity.uid}`);
        userId = await connectResidentIdentity(identity, input.invitation);
      } else if (path === "activate") {
        const input = activation.parse(body);
        await rateLimit(`activation:${input.email}`);
        userId = await activate(input);
      } else {
        const input = credentials.parse(body);
        await rateLimit(`login:${input.email}`);
        const user = (
          await pool().query("SELECT * FROM users WHERE email=$1", [
            input.email,
          ])
        ).rows[0];
        // Equal work for nonexistent and inactive accounts.
        const fallback = "00000000000000000000000000000000:" + "00".repeat(64);
        const valid = await checkPassword(
          input.password,
          user?.password_hash || fallback,
        );
        if (!user?.password_hash || !valid)
          throw new AppError("Email or password is incorrect.", 401);
        userId = user.id;
      }
      const result = respond({ ok: true });
      result.cookies.set(
        cookieName,
        await newSession(userId, lifetimeSeconds),
        {
          httpOnly: true,
          secure:
            new URL(process.env.APP_URL || "http://localhost:3000").protocol ===
            "https:",
          sameSite: "strict",
          path: "/",
          maxAge: lifetimeSeconds,
        },
      );
      return result;
    }
    const user = await currentUser(request.cookies.get(cookieName)?.value);
    if (!user) throw new AppError("Please sign in.", 401);
    if (!mutation && path === "dashboard")
      return respond(await service.dashboard(user));
    if (mutation && path === "logout") {
      await pool().query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(request.cookies.get(cookieName)!.value),
      ]);
      const result = respond({ ok: true });
      result.cookies.delete(cookieName);
      return result;
    }
    if (!mutation) throw new AppError("Not found.", 404);
    if(path === "operations-tool") {
      await rateLimit(`operations:${user.id}`,60);
      return respond(await inspectThroughMcp(request.cookies.get(cookieName)!.value,body));
    }
    const actions: Record<
      string,
      (u: NonNullable<typeof user>, raw: unknown) => Promise<unknown>
    > = {
      invite: service.inviteResident,
      intake: service.receiveParcel,
      windows: service.createWindow,
      schedule: service.scheduleDelivery,
      transition: service.transitionParcel,
      metrics: service.saveMetrics,
      profile: submitResidentProfile,
      "approve-resident": approveResident,
      "room-inspection": recordRoomInspection,
    };
    if (!actions[path]) throw new AppError("Not found.", 404);
    return respond(await actions[path](user, body));
  } catch (error) {
    if (error instanceof AppError)
      return respond({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return respond(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if ((error as { code?: string }).code === "23505")
      return respond(
        {
          error: "This tracking number, email, or service date already exists.",
        },
        409,
      );
    if ((error as { code?: string }).code === "22P02")
      return respond({ error: "Invalid identifier." }, 400);
    console.error("Liam request failed", {
      type: error instanceof Error ? error.name : "Unknown",
      code: (error as { code?: string }).code,
    });
    return respond(
      {
        error:
          "The request could not be completed. Refresh to check the current record before trying again.",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
