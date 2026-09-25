# Liam Concierge — MCP tools and architecture rationale

The local MCP server is `scripts/mcp-server.ts`, using the official TypeScript SDK over stdio. The application starts a short-lived server process and performs actual `tools/list` and `tools/call` protocol exchanges. The operator workspace at `/operations` invokes tools through this client; it does not relabel an ordinary HTTP service call as MCP.

## Current tools

| Tool | Access | Purpose and limits |
| --- | --- | --- |
| `get_parcels` | Own account | Physically recorded parcels and separate expected-package references. Even an owner sees only their own resident records here. Email claims are not custody evidence. |
| `get_available_windows` | Verified resident / owner | Available windows subject to shared booking limits. Availability is rechecked at booking. |
| `request_delivery` | Own account, explicit approval | Executes only the parcel/window in an existing trusted approval. No model-supplied user ID. Transactional and idempotent for repeat approval calls. |
| `get_package_details` | Own parcel; owner may inspect any parcel | Current recorded status, location, weight and weight source. Does not query a carrier or measure a box. |
| `get_room_capacity` | Owner | Latest physical observation per room: occupied slots, capacity if known, slot definition, observation time and percentage. |
| `get_aging_packages` | Owner | Oldest parcels still recorded as Needs review, Ready or Scheduled. Configurable 1–365-day threshold and bounded result count. |
| `get_package_exceptions` | Owner | Review holds, unmatched recipients, visible damage and uncertain weights. Returns reasons without changing status. |
| `preview_delivery_round` | Owner | Existing window bookings, stops, recorded weight, limits and uncertainties. Does not add bookings or optimize a route. |

Owner tools are omitted from the resident tool list, and each call independently checks authorization. In the current application `owner` is the only staff role; there is no separate property-management account role yet.

## Physical facts versus derived values

- A human records a room inspection in the owner-only form, with explicit confirmation. These observations are append-only. A later-entered older observation does not overwrite the latest physical check.
- Occupancy is `occupied_slots / capacity_slots × 100`. Both counts must use the same slot definition. Unknown capacity produces `null`, not zero or an invented percentage. Over-capacity observations can exceed 100%.
- Room observations are independent of parcel intake and expected emails. Arrivals, collections and unregistered packages between checks can change occupancy. There is no live video integration or automatic forecast.
- Parcel age is elapsed time since recorded intake, not a fresh observation that the parcel remains in the room. Out-for-delivery, delivered and collected records are excluded from the aging query. No messages are sent.
- Weight sources are `scale`, `label`, `estimate` and `unverified`, as declared by the operator at intake. Existing records migrate to `unverified`. A label value is not an independently measured weight. There is no scale hardware or carrier API connection.
- Booking still uses operator-entered weights. The preview flags uncertain values rather than certifying a measured load. Booking and preview share limits: 20 parcels, 150 lb and 3 parcels per resident per window; stop capacity comes from the window. Delivered bookings continue to consume the window's limits, matching the existing booking behavior.

## Why MCP instead of just an API?

The application retains its HTTP API and shared business services. MCP is a small adapter for AI-compatible clients, providing tool discovery, descriptions and machine-readable argument schemas through a standard protocol. A future compatible assistant can reuse the same operations without copying custody and booking logic. Remote ChatGPT/Claude integration still requires its own transport, authentication and testing; it is not enabled by this local server alone.

For a single web client, an ordinary API would be simpler and sufficient. We accept the additional client/server lifecycle and protocol overhead because nFactorial explicitly requires an integrated custom MCP server, and the intended product has multiple assistant entry points. We keep calculations and authorization in deterministic application services. MCP does not itself calculate occupancy, discover weight, enforce our user permissions or improve model quality.

Defense example:

> The operator asks which packages need attention before a round. Separate tools return aging records, unresolved issues and the existing manifest, with provenance and timestamps. The client can compose these operations while the same server rules protect resident data and booking changes. The web interface also works without an LLM; MCP is the reusable tool interface, not the business logic.

The operator screen also exposes explicit buttons, while `/concierge` uses live model intent classification to select room, aging or exception tools through LangGraph. Real Langfuse traces and the optional live browser test verify that path. Package details and round previews remain explicit operator actions.

## Local security and operation

Each server receives only a short-lived capability and database connection configuration. The capability is stored hashed and bound to the authenticated user, an application run and a live login session. Calls recheck expiry, session validity, role and resident ownership. Clients cannot select another resident ID. Capability records are removed when the client closes. Raw mailbox messages are not returned by these tools or passed to an LLM by the operator screen.

The only mutation exposed to MCP is `request_delivery`, which consumes trusted human approval in the same transaction as the existing booking operation. Physical inspection entry remains a human form/API operation. Tool annotations describe behavior; they are not authorization controls.

The current stdio implementation requires a Node process and access to the source tree on the local machine. It is not yet a remote MCP service or a verified serverless deployment. The application serves one property; multiple properties require tenant isolation.

## Reproduce the demonstration

1. Run the app and sign in as owner. Open **Room & delivery checks** from the sidebar.
2. On fictional rehearsal data, record a room with 48 occupied slots out of 60 and a clear slot definition. Show **80% occupied** and the check time; refresh to demonstrate persistence. Leave capacity blank in a second fictional room to demonstrate the unknown state.
3. Receive a fictional parcel and select its weight source. Inspect it through **Check package details**.
4. Use **Find package issues** and **Find aging packages**. Old-age fixtures are created only by automated tests, not in the main database.
5. Preview an existing delivery window. Show that the preview makes no bookings and identifies unverified weights.
6. A resident cannot open this workspace, call its API or discover its owner-only tools. A resident can read only their own package details.

`npm test` exercises the actual stdio protocol, all eight tools, ownership, revocation, inspection provenance, unknown capacity, age/status exclusions, repeat booking approval and read-only previews using isolated PostgreSQL schemas. `npm run test:browser` checks the form → API → MCP → database → rendered result flow on desktop and mobile with fictional data. LLM keys are disabled by default; `LIAM_BROWSER_LIVE_AI=true` also exercises model-selected operator checks, PDF RAG and vision.

Future tools should add a distinct decision or action: a reminder draft with separate send approval, or expected-to-received matching candidates requiring human confirmation. They should follow working notification/matching services, not introduce fabricated carrier data or duplicate existing reads just to increase tool count.
