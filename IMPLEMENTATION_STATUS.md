# Submission status — September 25, 2026 UTC

The academic core is implemented: authenticated frontend, branching LangGraph with durable human confirmation, eight actual MCP tools, runtime Skill, PDF RAG using pgvector, image extraction, real Langfuse traces, a 40-case evaluation set, model/settings experiments and chunking A/B. Documentation and a twelve-slide defense accompany the standalone repository.

Verified: 51 automated tests; production build and typecheck; full desktop/mobile browser workflow; real model vision and policy retrieval on fictional inputs. Golden output validity: 40/40. Vision has one observed tracking-digit error; see EVALS.md.

External setup: live Gmail still needs Google OAuth configuration and a resident's explicit authorization. Tests for Google network operations use mocked responses. Langfuse dashboard access requires its own invitation. GitHub repository access/visibility and final submission to nFactorial are separate from running the app.

Not implemented: three daily rounds, outbound aging notifications, bodycam storage, camera-based shelf localization, courier GPS, automatic email sync/ETA forecasts, Outlook OAuth, remote ChatGPT/Claude connector and public deployment. Current app supports one daily one-hour window and direct handoff. These are not claimed as completed features or approved property service.
