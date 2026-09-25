# Eight-minute defense

Preparation: run `npm run demo:setup`, configure AI/tracing, run `npm run rag:index`, and build/start or run dev. Open owner and resident accounts in separate browser profiles, plus the private Langfuse dashboard. Keep API keys and `.local/demo-access.txt` off-screen. Use only fictional fixtures.

1. **0:00–1:05 — Problem and scope.** Slides 1–2. Package-room assistance and scheduled apartment delivery; student demo, no property approval claim.
2. **1:05–1:50 — Resident flow.** Sign in as `avery@example.test`; open `/concierge`; ask “Please bring my parcel to my apartment” with AI consent. Show tools/steps, reload at confirmation, choose a Ready parcel/window, then confirm. Explain that capacity is rechecked. A guided button demonstrates the same workflow without model access.
3. **1:50–3:10 — Architecture and MCP.** Slides 4–5. Point to persisted checkpoints, the real server and the eight typed tools. As owner ask “What is the room occupancy?”; compare its recorded inspection timestamp with `/operations`. Explain why MCP complements the web/Gmail APIs.
4. **3:10–3:50 — RAG.** Ask “Do I need Gmail to use delivery?” Expand the source and open page 7. Ask “What is the exact approved insurance coverage?” to show a lack of established coverage instead of an invented amount.
5. **3:50–4:35 — Vision and Skill.** Owner opens `/label-intake`, uploads `evals/fixtures/label-01.png`, grants image-processing consent and reads the label. Show the suggested verified resident and confirm only after reviewing the fields. For a missing unit use label-11.png; leave it in review. The Skill is read from disk during every extraction.
6. **4:35–5:05 — Mail choice.** `/mail` offers manual tracking, a single shared notice and optional Gmail. Explain that expected notices cannot establish physical receipt. Live Gmail setup remains external.
7. **5:05–6:40 — Evaluation.** Slides 9–10. Show the actual JSON results, the single tracking error, 40-case composition, model/settings experiments and RAG A/B. The small synthetic set is not a field trial. RAG A/B shares ten questions with the golden set.
8. **6:40–7:20 — Observability.** Open a trace and show model settings, tokens, tool/Skill spans and redacted payloads. If dashboard access fails, show the sanitized trace manifest and prerecorded results; do not present a mock trace as live.
9. **7:20–8:00 — Limits and next steps.** Slide 12. Real-device evaluation and Gmail consent next; staffing, property approval and insurance remain separate launch work. Leave two minutes for questions.

If the API is unavailable, guided booking and operator tools still work. RAG/vision should show their real error; disclose the outage and use committed evaluation evidence. Do not claim a fallback model exists.

Repeat booking does not create a duplicate. For another demonstration, create a new fictional parcel or cancel a Scheduled parcel from the resident dashboard while cancellation is available. Never reset a real database.

Recorded fallback demo: [resident-demo.webm](docs/demo/resident-demo.webm). Re-record against an unused fictional Ready parcel with `npx playwright install ffmpeg` and `node --env-file=.env.local --experimental-strip-types scripts/record-demo.ts`. The recording includes a real AI/RAG request and incurs API usage.
