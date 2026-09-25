"use client";
import { useCallback, useEffect, useState } from "react";

type Overview = {
  configured: boolean;
  connection: null | {
    mailbox: string;
    last_sync_at: string | null;
    has_more: boolean;
  };
  deliveries: {
    id: string;
    carrier: string;
    tracking: string;
    email_claim: string;
    source: string;
    received_at: string;
  }[];
};
async function api(action: string, body?: unknown) {
  const response = await fetch(
    `/api/mail/${action}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}
export default function MailWorkspace() {
  const [data, setData] = useState<Overview | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false),
    [pasteConsent, setPasteConsent] = useState(false),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState("");
  const [method, setMethod] = useState<"manual" | "paste" | "gmail">("manual");
  const [carrier, setCarrier] = useState("Amazon"),
    [tracking, setTracking] = useState("");
  const refresh = useCallback(async () => setData(await api("status")), []);
  useEffect(() => {
    let active = true;
    api("status")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    const result = new URLSearchParams(window.location.search).get("result");
    if (result) {
      setMethod("gmail");
      setNotice(
        result === "connected"
          ? "Gmail connected. Choose Check Gmail to import delivery notices."
          : "Gmail was not connected. Please sign in and try again; read-only access must be granted.",
      );
      window.history.replaceState(null, "", "/mail");
    }
    return () => {
      active = false;
    };
  }, []);
  async function run(action: string, payload: unknown = {}) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api(action, payload);
      if (action === "connect") {
        window.location.assign(result.url);
        return;
      }
      if (action === "paste") {
        setNotice(
          result.duplicate
            ? "This notice was already imported."
            : result.candidates
              ? `${result.candidates} shipment reference(s) added for review.`
              : "No supported tracking number found. No shipment was added. Try including the tracking line from the notice.",
        );
        setSubject("");
        setBody("");
        setPasteConsent(false);
      }
      if (action === "manual") {
        setNotice(
          "Expected package saved. Your concierge will confirm when it is received.",
        );
        setTracking("");
      }
      if (action === "sync")
        setNotice(
          `Checked ${result.checked} messages; found ${result.matched} new shipment reference(s). ${result.hasMore ? "More notices are available. Choose Check more." : "This search is complete. Some formats may need manual entry."}`,
        );
      if (action === "disconnect")
        setNotice(
          result.revoked
            ? "Gmail disconnected and its imported notices removed."
            : "Local Gmail access and imports removed. Also remove Liam Concierge in your Google account connections; Google revocation could not be confirmed.",
        );
      if (action === "forget")
        setNotice(
          "Notice removed. It does not change a parcel's physical status.",
        );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mail-page">
      <header className="mail-header">
        <a href="/" className="wordmark">
          Liam Concierge
        </a>
        <a href="/" className="button">
          Back to packages
        </a>
      </header>
      <p className="eyebrow">YOUR DELIVERIES</p>
      <h1>A little less wondering.</h1>
      <p className="mail-intro">
        See what is on its way. Choose how much you share — connecting an email
        account is always optional. You can also wait for your concierge to
        check in your package without adding anything here.
      </p>
      {notice && (
        <p className="mail-notice" role="status">
          {notice}
        </p>
      )}
      <div
        className="mail-methods"
        role="group"
        aria-label="How to add expected packages"
      >
        <button
          className="mail-method"
          aria-pressed={method === "manual"}
          onClick={() => setMethod("manual")}
        >
          <strong>Tracking number only</strong>
          <span>No email access or email text</span>
        </button>
        <button
          className="mail-method"
          aria-pressed={method === "paste"}
          onClick={() => setMethod("paste")}
        >
          <strong>Share one notice</strong>
          <span>Only the text you choose to copy</span>
        </button>
        <button
          className="mail-method"
          aria-pressed={method === "gmail"}
          onClick={() => setMethod("gmail")}
        >
          <strong>Connect Gmail</strong>
          <span>Optional read-only mailbox connection</span>
        </button>
      </div>
      <div className="mail-entry">
        {method === "manual" && (
          <section className="mail-panel">
            <h2>Add an expected package</h2>
            <p>
              You choose what to share. A carrier and tracking number are
              enough; no mailbox connection is needed.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("manual", { carrier, tracking });
              }}
            >
              <label>
                Carrier
                <select
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                >
                  {[
                    "Amazon",
                    "UPS",
                    "FedEx",
                    "USPS",
                    "DHL",
                    "Walmart",
                    "GOFO",
                    "UniUni",
                    "SwiftX",
                    "Other",
                  ].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Tracking number
                <input
                  required
                  minLength={6}
                  maxLength={80}
                  pattern="[a-zA-Z0-9 -]+"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button className="button primary" disabled={busy}>
                Add expected package
              </button>
            </form>
          </section>
        )}
        {method === "gmail" && (
          <section className="mail-panel">
            <h2>Connect your Gmail</h2>
            {!data ? (
              <p>Loading your connection...</p>
            ) : data.connection ? (
              <>
                <p>
                  Connected: <strong>{data.connection.mailbox}</strong>
                </p>
                <p>
                  Last checked:{" "}
                  {data.connection.last_sync_at
                    ? new Date(data.connection.last_sync_at).toLocaleString()
                    : "Not yet"}
                </p>
                <p>
                  Checks run when you request them. Each check reads up to 20
                  matching notices from the last 30 days. Background sync is not
                  enabled.
                </p>
                <div className="mail-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => run("sync")}
                  >
                    {data.connection.has_more ? "Check more" : "Check Gmail"}
                  </button>
                </div>
                <details>
                  <summary>Disconnect and remove Gmail imports</summary>
                  <p>
                    This removes the connection and notices imported from Gmail.
                    Your checked-in packages, manual entries and pasted notices
                    remain.
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => run("disconnect")}
                  >
                    Disconnect and remove imports
                  </button>
                </details>
              </>
            ) : (
              <>
                <p>
                  Google grants read-only access to your mailbox. Liam Concierge
                  uses a delivery-related search, reads matching message text,
                  and stores extracted tracking references. This search is not a
                  Google-enforced restriction to delivery emails.
                </p>
                <p>
                  We do not send, delete or mark your emails as read.
                  Attachments are not downloaded. Message bodies are not
                  retained or sent to an AI provider.
                </p>
                <label className="mail-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  I understand and want to connect my Gmail for delivery
                  notices.
                </label>
                <button
                  className="button primary"
                  disabled={busy || !consent || !data.configured}
                  onClick={() => run("connect", { confirmed: true })}
                >
                  Connect Gmail
                </button>
                {!data.configured && (
                  <p className="form-hint">
                    Gmail connection is being prepared. You can paste a notice
                    instead.
                  </p>
                )}
              </>
            )}
          </section>
        )}
        {method === "paste" && (
          <section className="mail-panel">
            <h2>Share a single delivery notice</h2>
            <p>
              Copy the delivery notice from Gmail, Outlook or another mailbox.
              Include its tracking number. This is a manual import, not an inbox
              connection.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("paste", { subject, body, confirmed: pasteConsent });
              }}
            >
              <label>
                Subject
                <input
                  value={subject}
                  maxLength={300}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <label>
                Delivery notice
                <textarea
                  rows={6}
                  required
                  minLength={10}
                  maxLength={12000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Your package has shipped. Tracking: ..."
                />
              </label>
              <label className="mail-check">
                <input
                  type="checkbox"
                  checked={pasteConsent}
                  onChange={(e) => setPasteConsent(e.target.checked)}
                />
                This notice concerns my delivery, and I want to import its
                tracking references.
              </label>
              <button
                className="button primary"
                disabled={busy || !pasteConsent}
              >
                Import notice
              </button>
            </form>
          </section>
        )}
      </div>
      <section className="mail-panel">
        <h2>Your expected packages</h2>
        <p>
          This list is private to your account. An email saying “delivered” does
          not confirm receipt by Liam Concierge. Your concierge confirms
          physical receipt before a package becomes available for apartment
          delivery.
        </p>
        {data?.deliveries.length === 0 && (
          <div className="mail-empty">
            No expected packages yet. Add one using whichever method works for
            you.
          </div>
        )}
        <div className="mail-deliveries">
          {data?.deliveries.map((d) => (
            <article className="mail-delivery" key={d.id}>
              <div>
                <strong>{d.carrier}</strong>
                <p className="mail-tracking">{d.tracking}</p>
                <small>
                  {d.source === "gmail"
                    ? "Gmail notice"
                    : d.source === "manual"
                      ? "Added by you"
                      : "Shared notice"}{" "}
                  · {new Date(d.received_at).toLocaleDateString()}
                </small>
              </div>
              <div>
                <span className="mail-claim">
                  {d.source === "manual" ? "Expected" : d.email_claim}
                </span>
                <p className="form-hint">
                  {d.source === "manual"
                    ? "Awaiting concierge check-in"
                    : "Email report · not verified"}
                </p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => run("forget", { id: d.id })}
                aria-label={`Remove notice ${d.tracking}`}
              >
                Remove
              </button>
            </article>
          ))}
        </div>
        {!!data?.deliveries.length && (
          <p className="form-hint">
            Showing up to 100 recent notices. Unrecognized tracking formats may
            be omitted. No links or attachments from emails are opened.
          </p>
        )}
      </section>
    </main>
  );
}
