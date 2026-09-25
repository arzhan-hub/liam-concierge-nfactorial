"use client";
import { useEffect, useState } from "react";
import Icon from "./icons";
import SocialSignIn from "./social-sign-in";
export default function Auth({ activate = false }: { activate?: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (activate && window.location.hash) {
      setToken(window.location.hash.slice(1));
      window.history.replaceState(null, "", "/activate");
    }
  }, [activate]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/${activate ? "activate" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a href="/" className="wordmark">
          Liam Concierge
        </a>
        <div className="auth-copy">
          <p className="eyebrow">A LITTLE MORE EASE, EVERY DAY</p>
          <h1>
            Every parcel.
            <br />
            <em>In its place.</em>
          </h1>
          <p>
            A little more order.
            <br />A lot less searching.
          </p>
          <div className="parcel-art" aria-hidden="true">
            <div className="art-shelf">
              <div className="art-box box-one">
                <Icon name="box" size={54} />
                <span>READY FOR PICKUP</span>
              </div>
              <div className="art-box box-two">
                <span>LIAM CONCIERGE</span>
                <b>A · 02</b>
              </div>
            </div>
            <div className="art-caption">
              <span className="status-dot" /> A place for everything.
            </div>
          </div>
        </div>
        <div className="auth-footer">
          nFactorial final project <span>Demonstration</span>
        </div>
      </section>
      <section className="auth-form">
        <div className="form-intro">
          <p className="eyebrow">YOUR PACKAGE EXPERIENCE, SIMPLIFIED</p>
          <h2>{activate ? "Make yourself at home." : "Welcome back."}</h2>
          <p>
            {activate
              ? "Set up your invited account to get started."
              : "Sign in to your Liam Concierge account."}
          </p>
        </div>
        <SocialSignIn invitation={activate ? token : undefined} />
        <form onSubmit={submit}>
          {activate && (
            <label>
              Full name
              <input name="name" autoComplete="name" maxLength={80} required />
            </label>
          )}
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={activate ? "new-password" : "current-password"}
              minLength={12}
              maxLength={128}
              required
            />
            {activate && (
              <small>Use at least 12 characters and a unique password.</small>
            )}
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {activate && !token && (
            <p className="error">
              Open the complete activation link provided by the operator.
            </p>
          )}
          <button
            className="button primary full"
            disabled={busy || (activate && !token)}
          >
            {busy ? "Please wait…" : activate ? "Create account" : "Sign in"}
            <Icon name="arrow" />
          </button>
        </form>
        <p className="help-text">
          {activate
            ? "Your invitation is tied to your email address."
            : "Need access or a password reset? Contact Liam Concierge for a new invitation."}
        </p>
        <a className="presentation-link" href="/presentation">
          Explore the project <Icon name="arrow" size={16} />
        </a>
        <p className="small muted">
          Demonstration only. Property approval is not implied.
        </p>
      </section>
    </main>
  );
}
