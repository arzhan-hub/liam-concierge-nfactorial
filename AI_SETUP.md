# AI and tracing setup

First run `npm run demo` to create private `.env.local` and fictional demo accounts, then stop with Ctrl+C. Fill the AI entries below in that file; preserve its generated database settings and passwords. Never commit values or paste them into an issue. The default `npm run demo` deliberately disables AI in the launched process even when keys exist.

```dotenv
OPENAI_API_KEY=
AI_MODEL=gpt-4.1-mini-2025-04-14
AI_TRACING_PROVIDER=langfuse
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Use the base URL for the region in which your Langfuse project exists (for example, `https://us.cloud.langfuse.com` for US cloud). Both Langfuse keys are server-only. Alternatively choose `AI_TRACING_PROVIDER=langsmith` and set `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT`. Only Langfuse was verified against a live project in this submission.

Start live AI with `npm run demo -- --ai`. It checks the required keys, parses the included PDF and indexes both chunking variants before starting the app. First indexing incurs embedding API usage; unchanged indexes are reused. For manual development, `npm run rag:index` remains available. PostgreSQL must support pgvector. The default chat/vision model is the dated GPT-4.1 mini snapshot. The evaluation judge uses GPT-6 Luna; you need access to both to reproduce the recorded comparisons. Model availability and pricing can change; a different model requires a separately labeled result, not replacing the historical measurements.

`npm run eval:development` performs six configurations on twelve intent requests; `npm run eval:ab` runs both chunking methods on ten policy requests; `npm run eval:golden` runs forty frozen cases. These commands make paid API calls. All inputs are fictional. Results include configuration, dataset hash, output, usage and trace IDs. Traces redact raw prompts and outputs; no image upload is enabled in Langfuse. Check the dashboard for `liam.resident_concierge`, `liam.label_intake_draft`, `liam.label_extraction`, `liam.skill_liam_parcel_exceptions` and `liam.mcp_*`.

Dashboard access is private and separate from GitHub access. `evals/results/trace-audit.json` contains safe names/IDs and redaction checks, without credentials or private project URLs. To confirm a trace using your own project, run `node --env-file=.env.local --experimental-strip-types scripts/verify-trace.ts TRACE_ID`.

GitHub Actions runs ordinary verification on pushes/PRs with no API keys. A separate manual `Manual paid AI evaluation` workflow can run the golden suite after you configure the `ai-evaluation` environment secrets. It has not been triggered automatically and no API key has been uploaded to GitHub.
