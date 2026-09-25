# Mentor launch verification — September 25, 2026

Verified on macOS with Node.js 26.0.0, PostgreSQL 16.14 plus pgvector, Poppler and local Chrome. A separate clean copy contained only public candidate files: no `node_modules`, `.env.local`, `.local`, existing database or build output. Tests used app port 3105 and database port 55434, separate from the existing services.

| Check | Observed result |
| --- | --- |
| `npm run demo -- --check --port 3105 --db-port 55434` | Passed; did not create configuration or data directories |
| `npm run demo -- --port 3105 --db-port 55434` | Installed locked dependencies, created private configuration and database, seeded fictional records, built and served the production app |
| Operator and resident sign-in | Generated password worked; three parcels and two residents appeared |
| Operations | Room showed 48/60 slots (80%); the exception parcel showed five days since intake |
| Guided resident booking | Confirmation survived page reload; explicit confirmation scheduled one parcel through LangGraph and MCP |
| Browser inspection | Sign-in page loaded with agent-browser; no uncaught errors; desktop operations and mobile concierge checked visually |
| Duplicate launcher | Refused the occupied app port without stopping the existing instance |
| Ctrl+C | Released app/database ports, removed launcher lock, preserved data and credentials |
| Restart with real AI keys saved | Reused dependencies and records, preserved the booking and password, created no duplicate seed parcels; AI remained disabled in guided mode |
| `--ai` without keys | Stopped with a specific setup instruction before starting services |
| `npm run demo -- --ai --port 3105 --db-port 55434` | Indexed the included fictional PDF (8 section chunks and 24 fixed chunks), built and started the app |
| Live AI | A resident question about optional Gmail returned an answer with a page-7 demo-policy citation |
| Langfuse | Confirmed the live `liam.resident_concierge` trace through the authenticated trace API |
| Repeated PDF indexing | Both variants returned `cached: true` |
| Automated checks | 56 tests passed; production build and typecheck passed |

AI checks used local credentials excluded from the repository. Only fictional content was processed. No account passwords or keys are included in this report.

The existing GitHub Actions workflow separately tests the app on Linux with a PostgreSQL service; this report does not claim that the native launcher was exercised on Linux or WSL. Gmail OAuth, Google/Apple sign-in, physical phone scanning and public hosting are outside this launch verification.
