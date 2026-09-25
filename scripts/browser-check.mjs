import { chromium } from "@playwright/test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import assert from "node:assert/strict";
import zxing from "@zxing/library";

const schema = `liam_browser_${randomBytes(8).toString("hex")}`;
const liveAI=process.env.LIAM_BROWSER_LIVE_AI==="true";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("options", `-c search_path=${schema}`);
const base = "http://localhost:3001",
  setup = randomBytes(32).toString("hex");
const password = "Liam-rehearsal-password-2026";
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      APP_URL: base,
      SETUP_TOKEN: setup,
      LIVE_OPERATIONS: "false",
      FIREBASE_AUTH_ENABLED: "false",
      GMAIL_CLIENT_ID: "",
      GMAIL_CLIENT_SECRET: "",
      OPENAI_API_KEY: liveAI?process.env.OPENAI_API_KEY:"",
      LANGSMITH_API_KEY: "",
      LANGSMITH_TRACING: "false",
      AI_TRACING_PROVIDER: liveAI?"langfuse":"off",
      LANGFUSE_PUBLIC_KEY:liveAI?process.env.LANGFUSE_PUBLIC_KEY:"",
      LANGFUSE_SECRET_KEY:liveAI?process.env.LANGFUSE_SECRET_KEY:"",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
    if (i === 99) throw new Error(output);
  }
  browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {}), headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results", { recursive: true });
  await page.goto(base);
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Continue with Google" })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Continue with Apple" })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: "test-results/01-sign-in.png",
    fullPage: true,
  });
  await page.goto(`${base}/activate#${setup}`);
  await page.getByLabel("Full name").fill("Liam Founder");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "A calmer package room." }).waitFor();
  await page
    .getByRole("button", { name: "Invite your first resident" })
    .click();
  await page.getByLabel("Resident name").fill("Maya Chen");
  await page.getByLabel("Email address").fill("maya@example.com");
  await page.getByLabel("Building and unit").fill("1-204");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create private invitation" }).click();
  await page.getByRole("heading", { name: "Invitation ready." }).waitFor();
  const invitation = await page
    .getByLabel("Private activation link")
    .inputValue();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Receive parcel", exact: true })
    .click();
  // Real decoder, synthetic video source: no physical camera or resident data.
  const matrix = new zxing.QRCodeWriter().encode(
    "LIAM-DEMO-1001",
    zxing.BarcodeFormat.QR_CODE,
    300,
    300,
    new Map(),
  );
  const qrRows = Array.from({ length: matrix.getHeight() }, (_, y) =>
    Array.from({ length: matrix.getWidth() }, (_, x) => matrix.get(x, y)),
  );
  // Code 128 subset B fixture, including start, weighted checksum, and stop.
  const symbols = [..."LIAM-DEMO-1001"].map((c) => c.charCodeAt(0) - 32);
  const checksum =
    (104 + symbols.reduce((sum, symbol, i) => sum + symbol * (i + 1), 0)) % 103;
  const code128 = [104, ...symbols, checksum, 106].flatMap((symbol) =>
    Array.from(zxing.Code128Reader.CODE_PATTERNS[symbol]).flatMap((width, i) =>
      Array(width * 3).fill(i % 2 === 0),
    ),
  );
  const code128Rows = Array.from({ length: 160 }, () => [
    ...Array(30).fill(false),
    ...code128,
    ...Array(30).fill(false),
  ]);
  for (const bars of [qrRows, code128Rows]) {
    await page.getByLabel("Tracking number", { exact: true }).fill("");
    await page.evaluate((bars) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 500;
      const draw = () => {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 1000, 500);
        ctx.fillStyle = "black";
        bars.forEach((row, y) =>
          row.forEach((bar, x) => {
            if (bar) ctx.fillRect((1000 - row.length) / 2 + x, 100 + y, 1, 1);
          }),
        );
      };
      draw();
      navigator.mediaDevices.getUserMedia = async () => {
        const stream = canvas.captureStream(15);
        const timer = setInterval(draw, 60);
        window.__scanTracks = stream.getTracks();
        const stop = stream
          .getVideoTracks()[0]
          .stop.bind(stream.getVideoTracks()[0]);
        stream.getVideoTracks()[0].stop = () => {
          clearInterval(timer);
          stop();
        };
        return stream;
      };
    }, bars);
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await page
      .getByRole("button", { name: "Use this tracking number" })
      .waitFor({ timeout: 15000 });
    assert.equal(
      await page.getByLabel("Tracking number", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.evaluate(() =>
        window.__scanTracks.every((t) => t.readyState === "ended"),
      ),
      true,
    );
    await page
      .getByRole("button", { name: "Use this tracking number" })
      .click();
    assert.equal(
      await page.getByLabel("Tracking number", { exact: true }).inputValue(),
      "LIAM-DEMO-1001",
    );
  }
  await page.getByLabel("Weight (lb)").fill("5");
  await page.getByLabel("Weight source").selectOption("scale");
  await page.getByLabel("Name on label").fill("Maya Chen");
  await page.getByLabel("Unit on label").fill("1-204");
  await page
    .getByLabel("Verified resident")
    .selectOption({ label: "Maya Chen · 1-204" });
  await page.getByLabel("Shelf / location").fill("Shelf A · 02");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByRole("button", { name: "Maya Chen", exact: true }).waitFor();
  // Additional fixture parcels are fictional and exist only in this isolated test schema.
  const fixture = await page.evaluate(async () => {
    const r = await fetch("/api/dashboard");
    return r.json();
  });
  const residentId = fixture.residents[0].id;
  for (const [tracking, location, reason] of [
    ["LIAM-DEMO-1002", "Shelf A · 03", ""],
    [
      "LIAM-DEMO-1003",
      "Review · 01",
      "Unit unclear; resident confirmation needed.",
    ],
  ]) {
    const response = await context.request.post(`${base}/api/intake`, {
      headers: { Origin: base },
      data: {
        tracking,
        carrier: "UPS",
        label_name: "Maya Chen",
        label_unit: "1-204",
        location,
        resident_id: reason ? null : residentId,
        condition: "Intact",
        weight_lbs: 3,
        exception_reason: reason,
        safe_standard: true,
      },
    });
    assert.equal(response.status(), 200, await response.text());
  }
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("1 parcel needs a closer look.").waitFor();
  await page.screenshot({
    path: "test-results/02-operator.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Delivery windows", exact: true })
    .click();
  await page.getByRole("button", { name: "Open a window" }).click();
  const start = new Date(Date.now() + 2 * 3600000);
  const localStart = new Date(
    start.getTime() - start.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Start time in your device").fill(localStart);
  await page.getByLabel("Maximum resident stops").fill("4");
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByText("0 / 4 stops").waitFor();
  const residentContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const residentPage = await residentContext.newPage();
  residentPage.on("pageerror", (e) => errors.push(e.message));
  await residentPage.goto(invitation);
  await residentPage.getByLabel("Full name").fill("Maya Chen");
  await residentPage.getByLabel("Email address").fill("maya@example.com");
  await residentPage.getByLabel(/^Password/).fill(password);
  await residentPage.getByRole("button", { name: "Create account" }).click();
  await residentPage.getByRole("heading", { name: "Hello, Maya." }).waitFor();
  await residentPage
    .getByRole("button", { name: "Schedule", exact: true })
    .first()
    .click();
  await residentPage
    .getByLabel("Delivery window", { exact: true })
    .selectOption({ index: 1 });
  await residentPage.getByRole("button", { name: "Request delivery" }).click();
  await residentPage
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor();
  assert.equal(
    await residentPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile page should not overflow",
  );
  await residentPage.screenshot({
    path: "test-results/03-resident-mobile.png",
    fullPage: true,
  });
  const forbidden = await residentContext.request.post(`${base}/api/invite`, {
    headers: { Origin: base },
    data: {
      name: "Intruder",
      unit: "9",
      email: "intruder@example.com",
      verified: true,
    },
  });
  assert.equal(forbidden.status(), 403);
  const csrf = await context.request.post(`${base}/api/metrics`, {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  assert.equal(csrf.status(), 403);
  await page.getByRole("button", { name: /^Overview/ }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Verify & load", exact: true })
    .click();
  await page.getByLabel("Scan or re-enter full tracking number").fill("WRONG");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save record" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Tracking number does not match" })
    .waitFor();
  const raw = await context.request.get(`${base}/api/dashboard`);
  const state = await raw.json();
  const scheduled = state.parcels.find((p) => p.status === "Scheduled");
  await page
    .getByLabel("Scan or re-enter full tracking number")
    .fill(scheduled.tracking);
  // A keyboard scanner's Enter suffix must not release or load a package.
  await page.getByLabel("Scan or re-enter full tracking number").press("Enter");
  await page
    .getByText("Tracking entered. Confirm the remaining details before saving.")
    .waitFor();
  assert.equal(
    (
      await (await context.request.get(`${base}/api/dashboard`)).json()
    ).parcels.find((p) => p.id === scheduled.id).status,
    "Scheduled",
  );
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByRole("button", { name: "Handoff", exact: true }).click();
  await page
    .getByLabel("Scan or re-enter full tracking number")
    .fill(scheduled.tracking);
  await page.getByLabel("Confirm building and unit").fill("1-204");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByRole("button", { name: "Scorecard", exact: true }).click();
  await page
    .getByRole("heading", { name: "Progress, made visible." })
    .waitFor();
  await page.getByRole("button", { name: "Record results" }).click();
  await page.getByLabel("Total operator minutes").fill("130");
  await page.getByLabel("Staff interruptions").fill("3");
  await page.getByLabel("One package-search sample").fill("24");
  await page
    .getByLabel("Context / baseline notes")
    .fill("Fictional rehearsal observation — not a measured property result.");
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByText("130 min").waitFor();
  await page.screenshot({
    path: "test-results/04-scorecard.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Overview/ }).click();
  await page
    .getByRole("button", { name: "Receive parcel", exact: true })
    .click();
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await page.getByText(/Camera unavailable/).waitFor();
  await page.screenshot({
    path: "test-results/05-mobile-intake.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Test fixture session only: this tests the real onboarding/approval UI, not OAuth.
  const pendingId = randomUUID(),
    pendingToken = randomBytes(32).toString("hex");
  await db.query(
    `INSERT INTO ${schema}.users(id,email,name,role,firebase_uid) VALUES ($1,$2,$3,'resident',$4)`,
    [pendingId, "pending@example.com", "Jordan Example", randomUUID()],
  );
  await db.query(
    `INSERT INTO ${schema}.sessions VALUES ($1,$2,now()+interval '1 hour')`,
    [createHash("sha256").update(pendingToken).digest("hex"), pendingId],
  );
  const pendingContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await pendingContext.addCookies([
    {
      name: "liam_session",
      value: pendingToken,
      url: base,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const pendingPage = await pendingContext.newPage();
  pendingPage.on("pageerror", (e) => errors.push(e.message));
  await pendingPage.goto(base);
  await pendingPage.getByLabel("Resident name").fill("Jordan Example");
  await pendingPage.getByLabel("Building and apartment").fill("1-909");
  await pendingPage.getByRole("checkbox").check();
  await pendingPage
    .getByRole("button", { name: "Request residency verification" })
    .click();
  await pendingPage
    .getByRole("heading", { name: "Your details are with your concierge." })
    .waitFor();
  const pendingState = await (
    await pendingContext.request.get(`${base}/api/dashboard`)
  ).json();
  assert.equal(pendingState.user.verified_at, null);
  assert.equal(
    (await pendingContext.request.get(`${base}/api/mail/status`)).status(),
    403,
  );
  assert.deepEqual(pendingState.parcels, []);
  assert.deepEqual(pendingState.windows, []);
  await pendingPage.screenshot({
    path: "test-results/08-residency-pending-mobile.png",
    fullPage: true,
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Residents", exact: true }).click();
  await page.getByRole("button", { name: "Review residency" }).click();
  await page
    .getByLabel("Verification note")
    .fill("Fictional rehearsal check against approved test roster.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await pendingPage
    .getByRole("button", { name: "Check verification status" })
    .click();
  await pendingPage
    .getByRole("navigation", { name: "Main navigation" })
    .waitFor();
  assert.ok(
    (await (await pendingContext.request.get(`${base}/api/dashboard`)).json())
      .user.verified_at,
  );
  // Email expectations must stay separate from physically received packages.
  const parcelsBefore = (
    await (await residentContext.request.get(`${base}/api/dashboard`)).json()
  ).parcels.length;
  await residentPage.goto(`${base}/mail`);
  await residentPage
    .getByRole("heading", { name: "A little less wondering." })
    .waitFor();
  await residentPage
    .getByLabel("Tracking number", { exact: true })
    .fill("MANUAL-123456");
  await residentPage
    .getByRole("button", { name: "Add expected package" })
    .click();
  await residentPage.getByText("Added by you", { exact: false }).waitFor();
  assert.equal(
    (
      await (
        await residentContext.request.get(`${base}/api/mail/status`)
      ).json()
    ).connection,
    null,
  );
  await residentPage.screenshot({
    path: "test-results/12-manual-package-mobile.png",
    fullPage: true,
  });
  await residentPage
    .getByRole("button", { name: "Remove notice MANUAL123456" })
    .click();
  await residentPage
    .getByText("No expected packages yet.", { exact: false })
    .waitFor();
  await residentPage
    .getByRole("button", {
      name: "Connect Gmail Optional read-only mailbox connection",
    })
    .click();
  assert.equal(
    await residentPage
      .getByRole("button", { name: "Connect Gmail", exact: true })
      .isDisabled(),
    true,
  );
  await residentPage
    .getByRole("button", {
      name: "Share one notice Only the text you choose to copy",
    })
    .click();
  await residentPage
    .getByLabel("Subject", { exact: true })
    .fill("Your package was delivered");
  await residentPage
    .getByLabel("Delivery notice", { exact: true })
    .fill("Amazon tracking TBA123456789012. Your package was delivered.");
  assert.equal(
    await residentPage
      .getByRole("button", { name: "Import notice" })
      .isDisabled(),
    true,
  );
  await residentPage
    .getByLabel("This notice concerns my delivery", { exact: false })
    .check();
  await residentPage.getByRole("button", { name: "Import notice" }).click();
  await residentPage.getByText("Reported delivered", { exact: true }).waitFor();
  assert.equal(
    await residentPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await residentPage.screenshot({
    path: "test-results/10-mail-mobile.png",
    fullPage: true,
  });
  const mailStatus = await (
    await residentContext.request.get(`${base}/api/mail/status`)
  ).json();
  assert.equal(mailStatus.deliveries.length, 1);
  assert.equal(
    (await (await context.request.get(`${base}/api/mail/status`)).json())
      .deliveries.length,
    0,
    "Even owner cannot read resident's email imports",
  );
  assert.equal(
    (await (await residentContext.request.get(`${base}/api/dashboard`)).json())
      .parcels.length,
    parcelsBefore,
  );
  assert.equal(
    (
      await residentContext.request.post(`${base}/api/mail/paste`, {
        data: { body: "Amazon TBA123456789012", confirmed: true },
        headers: { Origin: "https://attacker.example" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await residentContext.request.post(`${base}/api/mail/paste`, {
        data: { body: "x".repeat(17000), confirmed: true },
        headers: { Origin: base },
      })
    ).status(),
    413,
  );
  await residentPage.setViewportSize({ width: 1440, height: 1000 });
  await residentPage.screenshot({
    path: "test-results/11-mail-desktop.png",
    fullPage: true,
  });
  await residentPage
    .getByRole("button", { name: "Remove notice TBA123456789012" })
    .click();
  await residentPage
    .getByText("No expected packages yet.", { exact: false })
    .waitFor();
  await residentPage.getByRole("link", { name: "Back to packages" }).click();
  await residentPage.getByRole("heading", { name: "Hello, Maya." }).waitFor();
  assert.deepEqual(errors, [], "Browser must not report uncaught errors");
  // Operator checks execute real MCP calls, with no LLM/API credentials.
  await page.goto(`${base}/operations`);
  await page
    .getByText("No inspections recorded. Room capacity is unknown.")
    .waitFor();
  await page.getByText("Record a room inspection", { exact: true }).click();
  await page
    .getByLabel("Room name", { exact: true })
    .fill("Overflow package room");
  await page.getByLabel("Occupied slots", { exact: true }).fill("48");
  await page.getByLabel("Total slots — optional", { exact: true }).fill("60");
  await page
    .getByLabel("What counts as one slot?", { exact: true })
    .fill("One marked standard-box space");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Save inspection", exact: true })
    .click();
  await page.getByText("80% occupied", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("80% occupied", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Find package issues", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Packages needing attention", exact: true })
    .waitFor();
  await page
    .getByRole("cell", {
      name: /needs review, recipient unmatched, weight not verified/,
    })
    .waitFor();
  await page
    .getByLabel("Package", { exact: true })
    .selectOption(
      fixture.parcels.find((p) => p.tracking === "LIAM-DEMO-1001").id,
    );
  await page
    .getByRole("button", { name: "Check package details", exact: true })
    .click();
  await page.getByRole("cell", { name: "5 lb · scale", exact: true }).waitFor();
  await page
    .getByLabel("Delivery window", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Preview delivery round", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Delivery window preview", exact: true })
    .waitFor();
  await page
    .getByText("Limits: 20 packages · 4 stops · 150 lb.", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/13-operations-desktop.png",
    fullPage: true,
  });
  await db.query(
    `UPDATE ${schema}.parcels SET received_at=now()-interval '5 days' WHERE tracking='LIAM-DEMO-1003'`,
  );
  await page
    .getByRole("button", { name: "Find aging packages", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "5 days since intake", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Operations page must fit a mobile screen",
  );
  await page.screenshot({
    path: "test-results/14-operations-mobile.png",
    fullPage: true,
  });
  assert.equal(
    (
      await residentContext.request.post(`${base}/api/operations-tool`, {
        headers: { Origin: base },
        data: { tool: "get_room_capacity" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await residentContext.request.post(`${base}/api/room-inspection`, {
        headers: { Origin: base },
        data: {},
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await context.request.post(`${base}/api/operations-tool`, {
        headers: { Origin: "https://attacker.example" },
        data: { tool: "get_room_capacity" },
      })
    ).status(),
    403,
  );
  await residentPage.goto(`${base}/operations`);
  await residentPage.getByRole("heading", { name: "Hello, Maya." }).waitFor();
  // Persisted human confirmation through the real LangGraph and MCP server.
  await residentPage.goto(`${base}/concierge`);
  await residentPage.getByRole("button",{name:"Request a delivery",exact:true}).waitFor();
  await residentPage.getByRole("button",{name:"Request a delivery",exact:true}).click();
  await residentPage.getByRole("heading",{name:"Review your delivery request",exact:true}).waitFor();
  await residentPage.reload();
  await residentPage.getByRole("heading",{name:"Review your delivery request",exact:true}).waitFor();
  await residentPage.getByLabel("Ready package",{exact:true}).selectOption({index:1});
  await residentPage.getByLabel("Delivery window",{exact:true}).selectOption({index:1});
  await residentPage.getByRole("button",{name:"Confirm delivery request",exact:true}).click();
  await residentPage.getByText("Your delivery request is confirmed for the selected window.",{exact:true}).waitFor();
  await residentPage.screenshot({path:"test-results/15-concierge-desktop.png",fullPage:true});
  await residentPage.setViewportSize({width:390,height:844});
  assert.equal(await residentPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await residentPage.screenshot({path:"test-results/16-concierge-mobile.png",fullPage:true});
  if(liveAI){
    // Only the synthetic policy corpus is copied, never resident or mailbox data.
    await db.query(`CREATE TABLE ${schema}.policy_chunks (LIKE public.policy_chunks INCLUDING ALL)`);
    await db.query(`INSERT INTO ${schema}.policy_chunks SELECT * FROM public.policy_chunks WHERE version='demo-2026-09-24-v1'`);
    await residentPage.getByLabel("Your message",{exact:true}).fill("Do I need Gmail to use delivery?");
    await residentPage.getByRole("checkbox").check();
    await residentPage.getByRole("button",{name:"Ask Liam Concierge",exact:true}).click();
    await residentPage.getByRole("heading",{name:"Sources · demo rules",exact:true}).waitFor({timeout:60000});
    await residentPage.screenshot({path:"test-results/17-live-rag-mobile.png",fullPage:true});
    await page.goto(`${base}/concierge`);
    await page.getByLabel("Your message",{exact:true}).fill("What is the room occupancy?");
    await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"Ask Liam Concierge",exact:true}).click();
    await page.getByText(/80% at last inspection/).waitFor({timeout:60000});
    await page.screenshot({path:"test-results/19-ai-operator-mobile.png",fullPage:true});
    await page.goto(`${base}/label-intake`);
    await page.getByLabel("Label image",{exact:true}).setInputFiles("evals/fixtures/label-01.png");
    await page.getByRole("checkbox").check();
    const labelResponse=page.waitForResponse(r=>r.url().endsWith("/api/labels/analyze"));
    await page.getByRole("button",{name:"Read label with AI",exact:true}).click();
    await page.getByRole("heading",{name:"Review before recording",exact:true}).waitFor({timeout:60000});
    const labelData=await (await labelResponse).json();
    await writeFile("test-results/live-label-trace.json",JSON.stringify({trace_id:labelData.trace_id}));
    assert.equal(await page.getByLabel("Recipient on label",{exact:true}).inputValue(),"Avery Stone");
    assert.equal(await page.getByLabel("Building / unit",{exact:true}).inputValue(),"DEMO-101");
    await page.getByLabel("Storage location",{exact:true}).fill("Fictional test shelf");
    await page.getByRole("checkbox",{name:/I checked the physical package/}).check();
    await page.getByRole("button",{name:"Confirm package intake",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Package recorded."}).waitFor();
    const synthetic=(await (await context.request.get(`${base}/api/dashboard`)).json()).parcels.find(p=>p.tracking==="TBA880000000000");
    assert.equal(synthetic.status,"Needs review");assert.equal(synthetic.resident_id,null);
    await page.screenshot({path:"test-results/18-label-intake-mobile.png",fullPage:true});
    console.log("PASS: live OpenAI + Langfuse, PDF RAG citations, image extraction with runtime Skill and human-confirmed unmatched intake (fictional data only).");
  }
  console.log("PASS: LangGraph checkpoint persisted across page reload, explicit confirmation, MCP booking, desktop/mobile concierge.");
  assert.deepEqual(
    errors,
    [],
    "Operations workspace must not report uncaught browser errors",
  );
  console.log(
    "PASS: real MCP-backed operator checks, room-inspection persistence, occupancy calculation, weight provenance, aging, exceptions, delivery preview, owner-only access, CSRF, desktop/mobile layout.",
  );
  console.log(
    "PASS: email import consent, expected delivery separation, private resident notices, pending-resident rejection, CSRF, body limit, removal, desktop/mobile mail workspace.",
  );
  console.log(
    "PASS: owner setup, resident invite, real barcode decoding from synthetic video, explicit scan confirmation, camera cleanup and permission-denied fallback, scanner Enter safety, intake, exception visibility, window creation, resident activation and request, role isolation, CSRF rejection, wrong-scan rejection, handoff, scorecard and desktop/mobile layout. Physical phone/scanner testing remains outstanding.",
  );
} catch (error) {
  if (browser) {
    let i = 0;
    for (const ctx of browser.contexts())
      for (const page of ctx.pages())
        await page.screenshot({
          path: `test-results/failure-${++i}.png`,
          fullPage: true,
        });
  }
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.on("exit", resolve));
  await db.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.end();
}
