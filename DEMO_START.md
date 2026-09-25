# Liam Concierge — mentor quick start

Clone or download this public repository, open its directory in a terminal, and run:

```sh
npm run demo
```

**Prerequisites:** Node.js 26+ with npm, PostgreSQL **16** (`initdb`, `pg_ctl`, `pg_config` on PATH), pgvector installed for that PostgreSQL installation, and Poppler (`pdftotext`). Run as a regular user on macOS or Linux. Windows users need WSL2. This command installs the locked Node dependencies; it does not install operating-system packages. Docker is not required or provided by this launcher.

On macOS, select the PostgreSQL 16 bin directory in PATH; verify `pg_config --version` and `initdb --version` both show 16.x. On Linux use your distribution's PostgreSQL 16, pgvector and Poppler packages. pgvector's `vector.control` must be under the extension directory reported by `pg_config --sharedir`. If prerequisites are missing, startup stops before installing or creating demo data and names the missing dependency.

## What the command does

1. Checks dependencies, configuration and free ports.
2. Creates private `.env.local` settings and random demo passwords if the file does not exist. Existing settings are preserved.
3. Runs `npm ci` on first use or when the lockfile changes.
4. Starts its own local PostgreSQL cluster, applies schema migrations and seeds fictional accounts, three parcels, an aging example, a room inspection and a future delivery window.
5. Builds the app and starts a production server on `http://localhost:3000`.

Wait for the server's **Ready** message. Open `.local/demo-access.txt` locally for the generated password and account names:

- Operator: `owner@example.test`
- Resident: `avery@example.test`
- Second resident: `morgan@example.test`

These are fictional local accounts, not real residents or public credentials. The app listens only on loopback. This launcher is for the academic demo, not deployment of the private service.

## Default mode: no paid AI calls

`npm run demo` explicitly disables model/tracing credentials in the launched process, even when keys are present in `.env.local`. You can inspect packages, use guided concierge buttons, confirm delivery, enter a parcel manually, inspect room capacity and share a fictional delivery notice. The UI accurately shows that AI is disconnected. Gmail and social sign-in remain disabled in this rehearsal.

Try the resident's **Request a delivery** button, reload at the confirmation step, select a Ready parcel and window, then confirm. As operator, open `/operations` and inspect the room, aging packages and existing round. See [DEMO.md](DEMO.md) for the defense script.

## Optional live AI

After the first guided start, stop the launcher with Ctrl+C. Edit `.env.local` with your own server-side OpenAI and tracing keys as described in [AI_SETUP.md](AI_SETUP.md). Then run:

```sh
npm run demo -- --ai
```

This explicitly enables paid AI usage. The launcher checks required key names and indexes the included fictional PDF for both chunking variants before building. First indexing makes embedding API calls; unchanged indexes are reused. Chat/vision requests occur only through the app's explicit consent controls. It does not automatically run paid evaluations. Missing/invalid credentials or failed indexing stop startup with an error; no fabricated AI response is substituted.

Configure the correct Langfuse region. Dashboard access is separate from GitHub access. Never paste keys into GitHub or share `.env.local` or `.local/demo-access.txt`. The default mode remains available without keys.

## Ports, checks and stopping

```sh
# Validate dependencies/configuration/ports without creating files or starting services:
npm run demo -- --check

# If the private service already uses port 3000:
npm run demo -- --port 3100

# A second CLEAN checkout may use another isolated database port:
npm run demo -- --port 3105 --db-port 55434
```

The database defaults to `127.0.0.1:55433/liam_nfactorial`, user `liam_demo`; a new checkout can select another port. Existing database URLs are never silently rewritten. The launcher refuses non-demo mode, live operations, remote hosts, another database/user and connection URL query parameters. It never stops an unrelated process to free a port.

Ctrl+C stops the app and the database **if this invocation started it**. A previously running demo database stays running. Data and generated credentials persist; later launches reuse them without duplicating the seeded parcels or resetting bookings. To stop a remaining demo database, run `npm run demo:stop` in that checkout. Do not change DEMO_PASSWORD after creating accounts: startup does not reset existing account passwords.

After a machine crash, `.local/demo-launcher.lock` may remain. Read its `pid`, confirm that launcher is no longer running, then remove only that lock directory. Do not remove `.local/postgres` or its PostgreSQL lock files. For an independent rehearsal, use a fresh checkout with different ports. Shared `node_modules` symlinks are deliberately refused before installation; use a normal clean clone for the mentor demo.

## What this does not claim

There is no public hosted service, live Gmail authorization, Google/Apple sign-in, automatic reminder sending, or physical Android camera verification. Guided mode does not satisfy the live LLM demonstration by itself; configure `--ai` and show real Langfuse traces for that part of the defense. The recorded video and committed evaluations are backup evidence, not simulated live outputs.
