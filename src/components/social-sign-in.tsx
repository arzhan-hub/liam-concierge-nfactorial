"use client";
import { useEffect, useRef, useState } from "react";
import type { Auth } from "firebase/auth";

type Settings = {
  configured: boolean;
  google: boolean;
  apple: boolean;
  config: {
    apiKey: string;
    appId: string;
    projectId: string;
    authDomain: string;
  } | null;
};
type AuthSdk = typeof import("firebase/auth");

export default function SocialSignIn({ invitation }: { invitation?: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = useRef<{ auth: Auth; sdk: AuthSdk } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      const response = await fetch("/api/auth-config", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const value: Settings = await response.json();
      if (cancelled) return;
      setSettings(value);
      if (!value.configured || !value.config) return;
      const [appSdk, sdk] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
      ]);
      if (cancelled) return;
      const app =
        appSdk.getApps().find((a) => a.name === "liam-resident") ??
        appSdk.initializeApp(value.config, "liam-resident");
      const auth = sdk.getAuth(app);
      await sdk.setPersistence(auth, sdk.inMemoryPersistence);
      if (cancelled) return;
      client.current = { auth, sdk };
      setReady(true);
    }
    prepare().catch(() => {
      if (!cancelled)
        setError(
          "Social sign-in is temporarily unavailable. Your invitation and password still work.",
        );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(kind: "google" | "apple") {
    if (!client.current || !consent || busy) return;
    setBusy(true);
    setError("");
    const { auth, sdk } = client.current;
    const provider =
      kind === "google"
        ? new sdk.GoogleAuthProvider()
        : new sdk.OAuthProvider("apple.com");
    if (kind === "apple") {
      provider.addScope("email");
      provider.addScope("name");
    } else provider.setCustomParameters({ prompt: "select_account" });
    try {
      // SDK is prepared before the click: open directly from the user gesture.
      const result = await sdk.signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken(true);
      const response = await fetch("/api/firebase-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          consent: true,
          ...(invitation ? { invitation } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to sign in.");
      await sdk.signOut(auth);
      window.location.assign("/");
    } catch (error) {
      const code = (error as { code?: string }).code;
      setError(
        code === "auth/popup-blocked"
          ? "Your browser blocked sign-in. Open this page directly in Safari or Chrome, allow popups, and try again."
          : code === "auth/popup-closed-by-user" ||
              code === "auth/cancelled-popup-request"
            ? "Sign-in was cancelled. You can try again."
            : code
              ? "This sign-in method is not available right now. Try your invitation or contact Liam Concierge."
              : error instanceof Error
                ? error.message
                : "Unable to sign in.",
      );
      await sdk.signOut(auth).catch(() => {});
      setBusy(false);
    }
  }
  return (
    <section className="social-sign-in" aria-label="Resident social sign-in">
      <p className="small muted">Resident sign-in</p>
      <div className="social-buttons">
        <button
          type="button"
          className="button full"
          disabled={!ready || !settings?.google || !consent || busy}
          onClick={() => signIn("google")}
        >
          Continue with Google
        </button>
        <button
          type="button"
          className="button full"
          disabled={!ready || !settings?.apple || !consent || busy}
          onClick={() => signIn("apple")}
        >
          Continue with Apple
        </button>
      </div>
      {settings?.configured && (
        <label className="consent-line">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I agree to link my sign-in identity with my Liam Concierge account,
          including the name and apartment I provide.
        </label>
      )}
      {settings && (!settings.google || !settings.apple) && (
        <p className="small muted">
          {!settings.google && !settings.apple
            ? "Google and Apple sign-in are being prepared. Use your invitation and password for this rehearsal."
            : !settings.apple
              ? "Apple sign-in is being prepared."
              : "Google sign-in is being prepared."}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small muted">
        Social sign-in is for residents. Residency is verified separately.
      </p>
      <div className="auth-divider">Or use your email and password</div>
    </section>
  );
}
