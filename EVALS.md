# Liam Concierge evaluation report

Recorded on 2026-09-25T02:47:03.377Z. Raw outputs are committed under `evals/results/`. All fixtures and identities are fictional.

## Dataset and method

The frozen golden set has 40 cases: 20 label images, 10 policy questions and 10 English/Russian intent requests. Twelve different intent examples form the development set. The PNG SHA-256 values are validated before evaluation. Golden JSON hash: `219bc0910dd3f5ca68e738d30a9b51fff679d94c59633f0e61905d1706c1722c`. Prompt version: `liam-v2`. Model: `gpt-4.1-mini-2025-04-14`; temperature 0, top_p 1, maximum output 512. The runner uses bounded concurrency of two, no automatic retries, and records failures as failures. It makes real API calls.

Vision metrics: exact equality of six fields per case, whole-label exact match, and downstream review-branch accuracy. Missing fields must remain null. Intent accuracy is exact intent equality. Policy accuracy combines expected-page citation checks and a minimal answer keyword check (or abstention for unsupported questions). An additional GPT-6 Luna judge evaluates faithfulness to returned excerpts and relevance; it is not independent human review.

## Golden results

| Task | n | Metric | Result | p50 / p95 |
|---|---:|---|---:|---|
| vision | 20 | field accuracy | 99.17% | 1129 / 2008 ms |
| policy | 10 | citation + keyword / abstention | 100.00% | 2219 / 3145 ms |
| intent | 10 | intent accuracy | 100.00% | 625 / 2088 ms |

All 40 outputs were valid. Vision: **119/120 fields**, **19/20 whole labels**, **20/20 review branches**. Policy judge: faithfulness **10/10**, relevance **10/10**. The mixed-task overall average in machine JSON is not used as a meaningful product-quality score.

### Observed error

Case `vision-14`: the model inserted an extra zero in a long USPS-style tracking number. The expected value is `9400660000000000000013`; the output was `94006600000000000000013`. That fixture also lacked a recipient name, so the app correctly required review. This does not prove the same tracking error would always be detected in a fully populated real label. Use a barcode scan and human verification; never treat vision output as custody authorization. No case was removed or relabeled after this run.

## Development model and parameter experiments

Each configuration ran once on the same twelve development intent requests. Only the named parameter changes from the baseline.

| Configuration | Model | Correct | p50 / p95 ms | Input / output tokens | Estimated generation cost |
|---|---|---:|---|---|---:|
| baseline | gpt-4.1-mini-2025-04-14 | 12/12 | 760 / 2216 | 2606 / 122 | $0.001238 |
| alternate-model | gpt-6-luna | 11/12 | 909 / 2805 | 2582 / 218 | $0.000367 |
| temperature-0.3 | gpt-4.1-mini-2025-04-14 | 12/12 | 654 / 2670 | 2606 / 122 | $0.001238 |
| top-p-0.8 | gpt-4.1-mini-2025-04-14 | 12/12 | 695 / 17762 | 2606 / 122 | $0.001238 |
| max-256 | gpt-4.1-mini-2025-04-14 | 12/12 | 696 / 1811 | 2606 / 122 | $0.001238 |
| max-1024 | gpt-4.1-mini-2025-04-14 | 12/12 | 759 / 2131 | 2606 / 122 | $0.001238 |

The dated GPT-4.1 mini model was selected after a preceding development comparison and reconfirmed in this run. It classified 12/12 versus GPT-6 Luna's 11/12; the ambiguous Russian request “Когда можно забрать доставку у консьержа?” was labeled as package lookup instead of available windows by Luna. At listed rates Luna was cheaper. These small single-run results favor mini for this demonstration, not every task or model family. Historical development files are retained.

Temperature 0.3, top_p 0.8, and output limits 256 and 1024 were tried separately. They did not improve classification accuracy over the chosen baseline. The 512-token limit leaves more room for vision/RAG than the 256-token classifier test; it is not proven optimal. A 17.8-second p95 outlier in the top_p run illustrates network/run variance and is not evidence that top_p causes latency.

## RAG A/B

Same PDF, questions, model, embedding model/dimensions, similarity threshold and top-k. Only chunking changes. A uses whole sections/pages (8 chunks); B uses 550-character chunks with 100-character overlap (24 chunks). Both corpus versions are indexed and retained.

| Variant | Correct | Faithfulness | Relevance | p50 / p95 ms | Answer input / output tokens |
|---|---:|---:|---:|---|---|
| sections | 10/10 | 10/10 | 10/10 | 2566 / 4136 | 11557 / 481 |
| fixed | 10/10 | 10/10 | 10/10 | 2375 / 3711 | 7885 / 530 |

The default retains coherent page sections and fewer indexed chunks. Fixed chunks used fewer answer tokens and had a slightly lower measured median; no quality difference appeared on these ten questions. This is a tradeoff, not a statistically established winner. **A/B reuses the ten golden policy questions**; do not describe those results as an independent holdout. Policy timings include retrieval, answer generation and the evaluation judge, so they are not the app's standalone answer latency.

## Cost accounting

Estimates use standard uncached USD prices per million tokens: GPT-4.1 mini input $0.40/output $1.60; GPT-6 Luna input $0.10/output $0.50. Source: [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), checked 2026-09-25. These are token-based estimates, not an account invoice. Cached input discounts, any cache-write charges, platform fees and infrastructure are not included.

Golden answer/extraction/classification calls recorded 47778 input and 1451 output tokens, estimated **$0.021433**. The ten judge calls add their own token usage in `judge_usage`; embeddings and trace hosting are additional. RAG embedding usage is traced but not included in each answer row. Do not present this partial estimate as complete project spend. Model choice must balance that cost with the measured quality and latency.

## Limits and reproduction

The label images are clean synthetic text layouts, not photographed carrier labels. They cover missing fields, unreadability, a conflicting decoded reference and excess weight, but do not represent real lighting, wrinkles, handwriting or barcode diversity. Real resident labels were intentionally excluded. There is no production success-rate claim.

Run `npm run eval:development`, `npm run eval:ab` and `npm run eval:golden` after configuring private keys and running `npm run rag:index`. Each run creates timestamped results and updates a latest file. Calls can vary even at temperature zero. Preserve the original dataset and report changed prompts/models as a new experiment. Unit/integration tests (51) and the full browser scenario separately verify state, access, confirmation and protocol behavior; they are not counted as AI golden cases.
