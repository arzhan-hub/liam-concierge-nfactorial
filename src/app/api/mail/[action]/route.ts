import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, currentUser, rateLimit } from "@/lib/auth";
import * as mail from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
type Context = { params: Promise<{ action: string }> };
async function handle(request: NextRequest, ctx: Context) {
  const { action } = await ctx.params;
  // Callback errors never echo authorization codes, provider payloads or tokens.
  if (request.method === "GET" && action === "callback") {
    let result = "connected";
    try {
      await mail.completeMailConnection(
        request.nextUrl.searchParams.get("code") || "",
        request.nextUrl.searchParams.get("state") || "",
        request.cookies.get("liam_mail_oauth")?.value || "",
        request.nextUrl.searchParams.has("error"),
      );
    } catch {
      result = "connection-failed";
    }
    const response = NextResponse.redirect(
      `${mail.mailOrigin()}/mail?result=${result}`,
      303,
    );
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set("liam_mail_oauth", "", {
      path: "/api/mail",
      maxAge: 0,
    });
    return response;
  }
  try {
    const session = request.cookies.get("liam_session")?.value;
    const user = await currentUser(session);
    if (!user) throw new AppError("Please sign in.", 401);
    if (request.method === "GET" && action === "status")
      return reply(await mail.mailOverview(user));
    if (request.method !== "POST") throw new AppError("Not found.", 404);
    if (request.headers.get("origin") !== mail.mailOrigin())
      throw new AppError("Request origin is not allowed.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("JSON body required.", 415);
    // Enforce a byte limit while streaming, not after buffering an unbounded body.
    const reader = request.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16000) {
          await reader.cancel();
          throw new AppError("Request is too large.", 413);
        }
        chunks.push(part.value);
      }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      throw new AppError("Invalid JSON.");
    }
    await rateLimit(`mail:${action}:${user.id}`, action === "sync" ? 10 : 30);
    if (action === "connect") {
      const result = await mail.startMailConnection(
        user,
        session!,
        (body as { confirmed?: boolean })?.confirmed === true,
      );
      const response = reply({ url: result.url });
      response.cookies.set("liam_mail_oauth", result.browser, {
        httpOnly: true,
        sameSite: "lax",
        secure: mail.mailOrigin().startsWith("https:"),
        path: "/api/mail",
        maxAge: 600,
      });
      return response;
    }
    if (action === "paste") return reply(await mail.pasteNotice(user, body));
    if (action === "manual")
      return reply(await mail.addExpectedDelivery(user, body));
    if (action === "sync") return reply(await mail.syncGmail(user));
    if (action === "disconnect") return reply(await mail.disconnectMail(user));
    if (action === "forget") return reply(await mail.forgetNotice(user, body));
    throw new AppError("Not found.", 404);
  } catch (error) {
    if (error instanceof AppError)
      return reply({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return reply(
        { error: "Please check the notice and your confirmation." },
        400,
      );
    if ((error as { code?: string }).code === "23505")
      return reply(
        { error: "This mailbox is already connected to an account." },
        409,
      );
    return reply(
      {
        error:
          "Email request could not be completed. Try again, or reconnect Gmail if access has expired.",
      },
      502,
    );
  }
}
export const GET = handle;
export const POST = handle;
