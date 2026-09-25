# Liam Concierge — optional resident email connection

This feature belongs to **each resident's personal account**. Firebase identifies users; Gmail OAuth separately lets a consenting user connect a mailbox. A project owner does not automatically get access to residents' mailboxes or imported expectations.

Residents can choose **Tracking number only**, **Share one notice**, or **Connect Gmail**. The default is tracking-only. They may also skip all three and use the existing service once an operator physically checks in their parcel. Connecting Gmail is never required to request an available apartment-delivery window.

## Current result — September 24, 2026

- `/mail`: private expected-package list, manual entry, selected-notice paste, optional Gmail connection and manual paginated sync.
- Expected packages are separate database records from physically received `parcels`. Email claims never change custody, identify a resident, or enable a delivery booking.
- OAuth authorization code + PKCE + expiring browser/session-bound state; refresh tokens encrypted with AES-256-GCM and bound to user ID.
- Gmail read-only scope; no sending, deleting, marking read, attachment download or opening email links. Subject/body processed transiently, not retained or sent to an LLM. Store extracted carrier/tracking, message ID, timestamp, claim and source only.
- Up to 20 matching messages per manual check, with pagination, from a fixed last-30-days interval. No background sync, history watch, ETA extraction or item descriptions yet. No tracking-number-free order import. Text recognition is conservative and incomplete.
- Gmail disconnect removes its tokens, states and imported records; it preserves manual/pasted sources and physical parcels, then attempts Google token revocation. A failed revocation is shown to the user with an instruction to remove access in Google Account connections.
- This academic copy contains no Google project credentials. Live Gmail has **not been connected or tested**.

## One-time Google Cloud setup

Use a Google Cloud project that you control. For this independent academic copy, create your own Web OAuth client; no service-account key is needed.

1. Enable [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. Configure [Google Auth Platform / OAuth consent](https://console.cloud.google.com/apis/credentials/consent): app name **Liam Concierge**, founder's chosen support/contact email, External audience, **Testing** status. Add only intended test accounts. Review Google's policy/terms confirmations yourself before accepting them.
3. Configure data access scope `https://www.googleapis.com/auth/gmail.readonly`. This is a **restricted** scope, allowing mailbox reading. A delivery-related search does not narrow the Google permission to delivery messages. The UI explicitly discloses that difference.
4. Create an OAuth client of type **Web application**, name **Liam Concierge local Gmail**, with Authorized redirect URI exactly:

   `http://localhost:3000/api/mail/callback`

   This is a server-side OAuth flow; Firebase's `__/auth/handler` is a different callback. Do not add public wildcard redirects. A later HTTPS deployment needs its own exact callback.
5. Download the client's JSON to this computer. **Do not put it in chat or commit it.** Import locally:

   ```sh
   cd liam-concierge-nfactorial
   npm run gmail:setup -- "/absolute/path/to/downloaded-client.json"
   ```

   The script validates type/redirect and, if `GMAIL_EXPECTED_PROJECT_ID` is set locally, the expected project, writes `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and a new `MAIL_TOKEN_KEY` to ignored `.env.local` with mode 600, and preserves an existing encryption key. It does not print secrets. Keep the encryption key in protected backups; rotating it requires migrating tokens or reconnecting mailboxes.
6. Restart `npm run dev`. Sign in to the intended **resident** account → **Expected packages** → **Connect Gmail**. Read the notice, confirm, then choose and authorize the intended Google account. Every resident does this separately. The founder's test account demonstrates the same per-user flow.
7. Choose **Check Gmail**. Test known delivery emails, repeated checks, pagination, another resident's isolation, and disconnect. For a notice with no recognized tracking number, use manual entry or report the format for a parser improvement.

While Google OAuth is in Testing, refresh tokens for these scopes generally expire after seven days. Public availability requires the applicable Google verification process; server-side use of restricted Gmail data can also require a security assessment. Do not present local tests as public production approval. See [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [token expiration](https://developers.google.com/identity/protocols/oauth2#expiration) and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Demonstrate without sharing a mailbox

Create/invite a fictional resident using the existing local rehearsal workflow. In **Expected packages**, use **Tracking number only**, choose Amazon and enter `TBA123456789012`. It appears as **Expected**, not a checked-in package. Or select **Share one notice** and paste:

> Your package has shipped. Amazon tracking: TBA123456789012

The same user/carrier/tracking is deduplicated. A second account cannot read or remove the first account's expected packages. The operator's physical-intake workflow remains a separate step.

Automated database tests use isolated schemas and mock Google's network responses. Browser tests use fictional residents and cover manual entry, consent, import, privacy, no physical-parcel creation, deletion and mobile layout. They are not evidence of a real Google authorization succeeding.

## Next product increments

1. Expand recognition using consented, redacted delivery-email fixtures: merchant/order references when no tracking exists, explicit arrival dates, cancellations and split shipments.
2. Background incremental sync with connection health, stale-data timestamps and bounded retries.
3. Microsoft Graph OAuth for Outlook. A selected-email forwarding address is an additional option only after inbound mail infrastructure and sender/account verification exist; it is not implemented here.
4. Match expectations to scanned physical parcels only within a verified resident's account, with operator review of conflicts. Operations may receive a separate resident-authorized minimal shipment view; personal mailbox contents are not an operator dashboard.
5. Optional AI extraction with a separate, specific disclosure and strict structured output. AI must never decide physical custody from email text.
