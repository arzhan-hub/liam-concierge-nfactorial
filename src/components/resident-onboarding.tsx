"use client";
import { useState } from "react";

export default function ResidentOnboarding({
  user,
  rehearsal,
  refresh,
  logout,
}: {
  user: {
    name: string;
    unit: string | null;
    profile_submitted_at?: string | null;
  };
  rehearsal: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!user.profile_submitted_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          unit: form.get("unit"),
          confirmed: form.has("confirmed"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await refresh();
      setEditing(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to save your details.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-page">
      <a href="/" className="wordmark">
        Liam Concierge
      </a>
      {rehearsal && (
        <p className="small muted">
          Local rehearsal · live resident enrollment is not open
        </p>
      )}
      <section className="onboarding-card">
        <p className="eyebrow">MAKE YOURSELF AT HOME</p>
        <h1>
          {editing
            ? "A few details, then we’ll take care of the rest."
            : "Your details are with your concierge."}
        </h1>
        {editing ? (
          <>
            <p>
              Please tell us the name used on your packages and your building
              and apartment. Your concierge verifies residency before package
              information becomes available.
            </p>
            <form onSubmit={submit}>
              <label>
                Resident name
                <input
                  name="name"
                  autoComplete="name"
                  defaultValue={user.name}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Building and apartment
                <input
                  name="unit"
                  autoComplete="address-line2"
                  defaultValue={user.unit || ""}
                  required
                  maxLength={30}
                  placeholder="For example, 1-204"
                />
              </label>
              <label className="consent-line">
                <input name="confirmed" type="checkbox" required />I confirm
                these details are accurate and agree to residency verification.
                {rehearsal &&
                  " During rehearsal, I am using fictional apartment details."}
              </label>
              <button className="button primary full" disabled={busy}>
                {busy ? "Saving…" : "Request residency verification"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p>
              We’re checking <strong>{user.name}</strong>, apartment{" "}
              <strong>{user.unit}</strong>. No package information is available
              until your residency is approved.
            </p>
            <div className="map-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await refresh();
                  } catch {
                    setError("Unable to check your status. Please try again.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Check verification status
              </button>
              <button className="button" onClick={() => setEditing(true)}>
                Edit my details
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <button
        className="button"
        onClick={() =>
          logout().catch(() =>
            setError("Unable to sign out. Please try again."),
          )
        }
      >
        Sign out
      </button>
    </main>
  );
}
