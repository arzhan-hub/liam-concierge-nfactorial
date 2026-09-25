# Liam Concierge — nFactorial Final Project

[![Verification](https://github.com/arzhan-hub/liam-concierge-nfactorial/actions/workflows/ci.yml/badge.svg)](https://github.com/arzhan-hub/liam-concierge-nfactorial/actions/workflows/ci.yml)

A package concierge application for residents and operators. The resident can check personal packages, ask service-rule questions and confirm a delivery request. The operator can review a label photo, record intake, inspect room occupancy and find aging packages. AI assists with language, images and policy retrieval; authenticated business rules control custody and booking.

This is an independent student demonstration. **All committed examples are fictional.** No property approval, insurance coverage or live resident service is implied.

![Resident concierge with fictional packages](docs/screenshots/concierge-desktop.png)

## One-command mentor demo

Prerequisites: **Node.js 26+, PostgreSQL 16 tools + matching pgvector, and Poppler**. From a clean clone:

```sh
npm run demo
```

The launcher checks prerequisites, installs locked dependencies, creates private settings, prepares an isolated local database with fictional data, builds and starts the app. Open http://localhost:3000 after **Ready**. Private generated sign-in details are in `.local/demo-access.txt`; no shared password is committed. Ctrl+C stops the app and a database started by this invocation while preserving demo records.

Default mode makes no paid AI calls, even if keys exist in `.env.local`. Guided package queries, confirmed booking, manual intake, shared delivery notices and room checks work without AI. For real AI, stop the launcher, add your own OpenAI and tracing keys to **`.env.local`** using [AI_SETUP.md](AI_SETUP.md), then run:

```sh
npm run demo -- --ai
```

AI mode indexes the fictional PDF automatically, reusing unchanged indexes, then starts the app. First indexing and explicit AI requests incur API usage; paid evaluations are not run automatically. Gmail and social sign-in remain disabled in this mentor rehearsal.

[Complete startup guide](DEMO_START.md) · [Clean-checkout verification](docs/mentor-start-verification.md) covers prerequisites, modes, ports, stopping and recovery. `npm run demo -- --check` only validates prerequisites/settings/ports. If port 3000 is occupied, use `npm run demo -- --port 3100`. The default database is `127.0.0.1:55433/liam_nfactorial`; a second clean checkout can select `--db-port 55434`. Existing settings and data are preserved; other database targets are refused.

For development after setup, `npm run dev` remains available and follows `.env.local` directly; unlike the demo launcher it does not force guided mode. Do not point any demo command at a production database.

## Demonstration

[Watch the recorded browser demo](docs/demo/resident-demo.webm): fictional resident booking, persisted confirmation and a real cited AI answer. This is a recording; a public hosted application URL is not available.

- `/concierge`: personal package tools, EN/RU intent classification, persisted confirmation and cited PDF answers.
- `/label-intake`: owner-only image extraction, runtime Skill, local recipient suggestions and explicit intake confirmation.
- `/operations`: actual MCP tools for room occupancy, age, exceptions, weight details and delivery preview.
- `/mail`: manual tracking or one shared delivery notice; optional personal Gmail authorization.
- `/presentation`: twelve-slide defense outline; [PDF for submission](public/defense/Liam_Concierge_nFactorial.pdf) and [editable PowerPoint](public/defense/Liam_Concierge_nFactorial.pptx).

Follow [DEMO.md](DEMO.md) for the eight-minute defense and exact test inputs. Gmail setup is separate: [GMAIL_SETUP.md](GMAIL_SETUP.md). A real mailbox has **not** been verified; integration tests mock Google's responses.

## Requirement evidence

| Requirement | Implementation / evidence |
|---|---|
| Frontend | Next.js / React resident and operator workspaces; screenshots above and in `docs/screenshots/` |
| Branching agent and human confirmation | LangGraph, PostgreSQL checkpoints, resume endpoint; `tests/assistant.test.ts` |
| Own MCP server with substantive tools | Eight tools, actual SDK stdio protocol; `scripts/mcp-server.ts`, [MCP_TOOLS.md](MCP_TOOLS.md) |
| Own Skill used in practice | `skills/liam-parcel-exceptions/SKILL.md`, loaded by the vision pipeline; trace audit |
| PDF RAG / embeddings / vector DB / citations | Real PDF parsing, OpenAI embeddings, pgvector and UI page references |
| Multimodality | Image extraction with human review plus local barcode decoder |
| Langfuse or LangSmith | Real Langfuse model, graph, MCP and Skill traces; redacted metadata manifest |
| Golden set ≥30 and automated metrics | 40 frozen cases, 12 distinct development requests; [EVALS.md](EVALS.md) |
| A/B and model/settings experiments | Two chunking methods, two models, temperature/top_p/output-limit variants |
| Architecture and reproducibility | [ARCHITECTURE.md](ARCHITECTURE.md), lockfile, setup and CI |
| Defense ≤10 min, 10–15 slides | Twelve slides and an eight-minute script |

## Label examples and OCR

[Label examples, sources and OCR-first design](LABEL_DATASET.md): 11 CC BY 4.0 photos of 10 distinct synthetic UPS-style labels, fictional Walmart-style and Amazon-style OCR examples with replaced identifiers, and references for other carriers. `npm run eval:ocr` runs a local Tesseract benchmark without AI API calls. These exploratory cases are separate from the frozen golden set; browser OCR integration remains future work.

## Verification

```sh
npm test
npm run build
npm run typecheck
npx playwright install chromium
npm run test:browser
```

The database must be running. Tests create and remove randomly named schemas, without touching demo records. Browser verification starts a production server on port 3001 and uses fictional accounts. Set `BROWSER_CHANNEL=chrome` to use an installed Google Chrome instead of Playwright Chromium. After indexing the synthetic policy, `LIAM_BROWSER_LIVE_AI=true npm run test:browser` additionally verifies actual OpenAI vision and PDF RAG with Langfuse. This incurs API usage.

Recorded verification: 56 automated tests, production build/typecheck and the full browser workflow passed. The golden suite returned valid output for 40/40 cases; field-level vision accuracy was 119/120 with one long tracking-number error. Details and limitations are in [EVALS.md](EVALS.md). Do not interpret this as real-world mailroom accuracy or a guarantee of a grade.

## Scope and repository contents

The repository includes only the academic application, synthetic fixtures, demonstration policy, evaluation results and defense materials. It excludes `.env.local`, credentials, databases, real label photos, residents' emails and addresses, property maps, bodycam footage and commercial correspondence. The original product workspace is separate.

Three daily rounds, outbound reminders, bodycam links, live courier GPS, Outlook/forwarding, remote ChatGPT/Claude connectors and public hosting remain future work. Current occupancy uses a timestamped manual inspection; weight has an explicit source. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
