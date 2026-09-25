"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Auth from "./auth";
import Icon from "./icons";
import TrackingInput from "./tracking-input";
import ResidentOnboarding from "./resident-onboarding";

type Parcel = {
  id: string;
  tracking: string;
  carrier: string;
  resident_id: string | null;
  label_name: string;
  label_unit: string;
  location: string;
  status: string;
  condition: string;
  weight_lbs: string;
  exception_reason: string;
  resident_name: string | null;
  resident_unit: string | null;
  window_id: string | null;
  received_at: string;
  starts_at: string | null;
  ends_at: string | null;
};
type Resident = {
  id: string;
  name: string;
  email: string;
  unit: string;
  activated: boolean;
  verified_at: string | null;
  profile_submitted_at: string | null;
};
type Window = {
  id: string;
  starts_at: string;
  ends_at: string;
  cutoff_at: string;
  capacity: number;
  booked_stops: number;
  parcel_count: number;
  weight_lbs: number;
};
type Event = {
  id: string;
  parcel_id: string;
  tracking: string;
  actor_name: string;
  from_status: string | null;
  to_status: string;
  note: string;
  created_at: string;
};
type Metric = {
  day: string;
  minutes: number;
  interruptions: number;
  search_seconds: number | null;
  note: string;
};
type Data = {
  user: {
    id: string;
    name: string;
    role: "owner" | "resident";
    unit: string | null;
    verified_at: string | null;
    profile_submitted_at: string | null;
  };
  parcels: Parcel[];
  residents: Resident[];
  windows: Window[];
  events: Event[];
  metrics: Metric[];
  rehearsal: boolean;
};
type Modal = {
  kind:
    | "intake"
    | "invite"
    | "approve-resident"
    | "window"
    | "metrics"
    | "detail"
    | "transition"
    | "schedule";
  parcel?: Parcel;
  resident?: Resident;
  action?: string;
};
const fmt = (
  date: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    ...options,
  }).format(new Date(date));
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const active = (p: Parcel) => !["Delivered", "Collected"].includes(p.status);
const badge = (status: string) => (
  <span
    className={`badge ${status === "Needs review" ? "amber" : status === "Ready" || status === "Delivered" || status === "Collected" ? "green" : "stone"}`}
  >
    <span />
    {status}
  </span>
);

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null),
    [signedOut, setSignedOut] = useState(false),
    [tab, setTab] = useState("Overview"),
    [filter, setFilter] = useState("Active"),
    [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invite, setInvite] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (response.status === 401) {
      setSignedOut(true);
      setData(null);
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setData(result);
    setSignedOut(false);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (modal) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [modal]);
  function open(value: Modal) {
    setError("");
    setInvite("");
    setModal(value);
  }
  async function mutate(path: string, body: unknown) {
    const response = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  async function logout() {
    try {
      await mutate("logout", {});
      setSignedOut(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const value = Object.fromEntries(form) as Record<string, string>;
    try {
      let path = "",
        body: unknown = value;
      if (modal.kind === "intake") {
        path = "intake";
        body = {
          ...value,
          resident_id: value.resident_id || null,
          safe_standard: form.has("safe_standard"),
        };
      }
      if (modal.kind === "invite") {
        path = "invite";
        body = { ...value, verified: form.has("verified") };
      }
      if (modal.kind === "window") {
        // Delivery windows remain separate from residency approval.
        path = "windows";
        body = {
          starts_at: new Date(value.starts_at).toISOString(),
          capacity: Number(value.capacity),
        };
      }
      if (modal.kind === "metrics") {
        path = "metrics";
        body = {
          ...value,
          search_seconds:
            value.search_seconds === "" ? null : Number(value.search_seconds),
        };
      }
      if (modal.kind === "approve-resident") {
        path = "approve-resident";
        body = {
          id: modal.resident!.id,
          name: modal.resident!.name,
          unit: modal.resident!.unit,
          note: value.note,
          confirmed: form.has("confirmed"),
        };
      }
      if (modal.kind === "schedule") {
        path = "schedule";
        body = { parcel_id: modal.parcel!.id, window_id: value.window_id };
      }
      if (modal.kind === "transition") {
        path = "transition";
        body = {
          ...value,
          id: modal.parcel!.id,
          action: modal.action,
          confirmed: form.has("confirmed"),
        };
      }
      const result = await mutate(path, body);
      await refresh();
      if (result.url) {
        setInvite(result.url);
      } else {
        setModal(null);
        setNotice("Saved. The record is up to date.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  if (signedOut) return <Auth />;
  if (!data)
    return (
      <main className="loading">
        <span className="wordmark">Liam Concierge</span>
        <p>{error || "Preparing your workspace…"}</p>
        {error && (
          <button
            className="button"
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            Try again
          </button>
        )}
      </main>
    );
  const owner = data.user.role === "owner";
  if (!owner && !data.user.verified_at)
    return (
      <ResidentOnboarding
        user={data.user}
        rehearsal={data.rehearsal}
        refresh={refresh}
        logout={logout}
      />
    );
  const tabs = owner
    ? ["Overview", "Delivery windows", "Residents", "Scorecard"]
    : ["My parcels", "Delivery windows"];
  const selected = owner ? tab : tab === "Overview" ? "My parcels" : tab;
  const live = data.parcels.filter(active),
    ready = live.filter((p) => p.status === "Ready"),
    review = live.filter((p) => p.status === "Needs review");
  const scheduled = live.filter((p) =>
    ["Scheduled", "Out for delivery"].includes(p.status),
  );
  const filtered = data.parcels.filter(
    (p) =>
      (filter === "All" ||
        (filter === "Active" && active(p)) ||
        p.status === filter) &&
      `${p.tracking} ${p.label_name} ${p.resident_name || ""} ${p.label_unit} ${p.resident_unit || ""} ${p.location}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const modalTitle =
    modal?.kind === "transition"
      ? {
          resolve: "Resolve exception",
          load: "Verify & load parcel",
          deliver: "Confirm resident handoff",
          collect: "Confirm collection",
          exception: "Record an exception",
          cancel: "Cancel delivery request",
        }[modal.action || ""]
      : {
          intake: "Receive a parcel",
          invite: "Invite a resident",
          "approve-resident": "Verify residency",
          window: "Open a delivery window",
          metrics: "Record daily results",
          detail: "Parcel record",
          schedule: "Schedule delivery",
        }[modal?.kind || "detail"];
  const residentSelect = (required = true) => (
    <label>
      Verified resident
      <select
        name="resident_id"
        required={required}
        defaultValue={modal?.parcel?.resident_id || ""}
      >
        <option value="">
          {required ? "Choose a resident" : "Unmatched — hold for review"}
        </option>
        {data.residents
          .filter((r) => r.verified_at)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.unit}
            </option>
          ))}
      </select>
    </label>
  );
  const transitionButton = (p: Parcel, action: string, label: string) => (
    <button
      className="text-button"
      onClick={() => open({ kind: "transition", parcel: p, action })}
    >
      {label}
    </button>
  );
  const parcelActions = (p: Parcel) => (
    <div className="row-actions">
      {owner &&
        p.status === "Needs review" &&
        transitionButton(p, "resolve", "Review")}
      {p.status === "Ready" && (
        <button
          className="text-button"
          onClick={() => open({ kind: "schedule", parcel: p })}
        >
          Schedule
        </button>
      )}
      {owner &&
        p.status === "Ready" &&
        transitionButton(p, "collect", "Collect")}
      {owner &&
        p.status === "Scheduled" &&
        transitionButton(p, "load", "Verify & load")}
      {p.status === "Scheduled" && transitionButton(p, "cancel", "Cancel")}
      {owner &&
        p.status === "Out for delivery" &&
        transitionButton(p, "deliver", "Handoff")}
      {owner &&
        ["Ready", "Scheduled", "Out for delivery"].includes(p.status) &&
        transitionButton(p, "exception", "Exception")}
      {!active(p) && <span className="muted small">Complete</span>}
    </div>
  );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a href="/" className="wordmark">
          Liam Concierge
        </a>
        <div className="property-label">
          <span className="property-monogram">LC</span>
          <div>
            Demonstration community
            <small>{owner ? "Operator workspace" : "Resident concierge"}</small>
          </div>
        </div>
        <p className="nav-label">{owner ? "WORKSPACE" : "YOUR CONCIERGE"}</p>
        <nav aria-label="Main navigation">
          <a href="/mail" className="nav-item">Expected packages</a>
          <a href="/concierge" className="nav-item">Ask Liam Concierge</a>
          {tabs.map((name, i) => (
            <button
              key={name}
              className={selected === name ? "nav-item selected" : "nav-item"}
              onClick={() => {
                setTab(name);
                setNotice("");
              }}
            >
              <Icon name={["grid", "clock", "people", "chart"][i]} />
              {name}
              {name === "Overview" && review.length > 0 && (
                <span className="nav-count">{review.length}</span>
              )}
            </button>
          ))}
          {owner && (
            <a href="/operations" className="nav-item">Room &amp; delivery checks</a>
          )}
          {owner && <a href="/label-intake" className="nav-item">Read a label</a>}

        </nav>
        <div className="sidebar-bottom">
          <a href="/presentation" className="nav-item">
            <Icon name="arrow" />
            Project presentation
          </a>
          <div className="user-block">
            <span className="avatar">{data.user.name.slice(0, 1)}</span>
            <div>
              {data.user.name}
              <small>
                {owner ? "Founder & operator" : `Unit ${data.user.unit}`}
              </small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={logout}
            >
              <Icon name="exit" />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <div className="topline">
          <span>
            <span className="status-dot" />
            {data.rehearsal
              ? "Local rehearsal · use fictional data"
              : "Pilot operations"}
          </span>
          <span className="top-date">
            {fmt(new Date().toISOString(), {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <button
            className="icon-button mobile-signout"
            aria-label="Sign out on mobile"
            onClick={logout}
          >
            <Icon name="exit" />
          </button>
        </div>
        <header className="page-header">
          <div>
            <p className="eyebrow">
              {owner ? "A LITTLE MORE ORDER" : "A LITTLE MORE EASE"}
            </p>
            <h1>
              {selected === "Overview"
                ? "A calmer package room."
                : selected === "My parcels"
                  ? `Hello, ${data.user.name.split(" ")[0]}.`
                  : selected === "Scorecard"
                    ? "Progress, made visible."
                    : selected === "Residents"
                      ? "Your pilot community."
                      : "A window that works."}
            </h1>
            <p>
              {selected === "Overview"
                ? "Every accepted parcel has a location and a next step."
                : selected === "My parcels"
                  ? "Your parcels, ready when you are."
                  : selected === "Scorecard"
                    ? "Measured results for the one-month pilot."
                    : selected === "Residents"
                      ? "Invite residents after confirming their identity and unit."
                      : "Scheduled resident handoff. All displayed windows use Eastern Time."}
            </p>
          </div>
          {owner && (
            <button
              className="button primary"
              onClick={() =>
                open({
                  kind:
                    selected === "Residents"
                      ? "invite"
                      : selected === "Delivery windows"
                        ? "window"
                        : selected === "Scorecard"
                          ? "metrics"
                          : "intake",
                })
              }
            >
              <Icon name="plus" />
              {selected === "Residents"
                ? "Invite resident"
                : selected === "Delivery windows"
                  ? "Open a window"
                  : selected === "Scorecard"
                    ? "Record results"
                    : "Receive parcel"}
            </button>
          )}
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button className="text-button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {error && !modal && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {(selected === "Overview" || selected === "My parcels") && (
          <>
            <section className="stats" aria-label="Parcel summary">
              {[
                {
                  n: live.length,
                  label: owner ? "In your care" : "Active parcels",
                  detail: "Across all open statuses",
                  icon: "box",
                },
                {
                  n: ready.length,
                  label: "Ready for pickup",
                  detail: "Matched and located",
                  icon: "check",
                },
                {
                  n: scheduled.length,
                  label: "Scheduled & on route",
                  detail: "Awaiting resident handoff",
                  icon: "clock",
                },
                {
                  n: review.length,
                  label: "Needs attention",
                  detail: "Exceptions to resolve",
                  icon: "search",
                },
              ].map((s) => (
                <div className="stat" key={s.label}>
                  <div className="stat-top">
                    <span>{s.label}</span>
                    <Icon name={s.icon} />
                  </div>
                  <strong>{String(s.n).padStart(2, "0")}</strong>
                  <small>{s.detail}</small>
                </div>
              ))}
            </section>
            {review.length > 0 && (
              <div className="attention">
                <span className="attention-symbol">!</span>
                <div>
                  <b>
                    {review.length}{" "}
                    {review.length === 1 ? "parcel needs" : "parcels need"} a
                    closer look.
                  </b>
                  <p>
                    {owner
                      ? "Confirm the recipient or resolve the recorded exception before release."
                      : "The operator is reviewing your parcel. It cannot be scheduled yet."}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setFilter("Needs review")}
                >
                  View exceptions <Icon name="arrow" size={16} />
                </button>
              </div>
            )}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>{owner ? "The package room" : "Your parcels"}</h2>
                  <p>
                    {filtered.length}{" "}
                    {filtered.length === 1 ? "parcel" : "parcels"} in this view
                  </p>
                </div>
                <label className="search-label">
                  <Icon name="search" />
                  <input
                    aria-label="Search parcels"
                    placeholder="Search name, unit, tracking…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="filters">
                {["Active", "Ready", "Scheduled", "Needs review", "All"].map(
                  (f) => (
                    <button
                      key={f}
                      className={filter === f ? "filter active" : "filter"}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ),
                )}
                <button
                  className="text-button refresh"
                  onClick={() => refresh().catch((e) => setError(e.message))}
                >
                  Refresh
                </button>
              </div>
              {filtered.length === 0 ? (
                <div className="empty">
                  <span className="empty-icon">
                    <Icon name="box" size={34} />
                  </span>
                  <h3>
                    {search || filter !== "Active"
                      ? "No matching parcels."
                      : "A clean slate."}
                  </h3>
                  <p>
                    {owner
                      ? "Invite a fictional resident, then receive your first practice parcel."
                      : "Your accepted parcels will appear here after intake."}
                  </p>
                  {owner && data.residents.length === 0 && (
                    <button
                      className="button"
                      onClick={() => open({ kind: "invite" })}
                    >
                      Invite your first resident
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="parcel-cards">
                    {filtered.map((p) => (
                      <article className="parcel-card" key={p.id}>
                        <div className="parcel-card-top">
                          <button
                            className="parcel-title"
                            onClick={() => open({ kind: "detail", parcel: p })}
                          >
                            {p.resident_name || p.label_name}
                            <Icon name="arrow" size={16} />
                          </button>
                          {badge(p.status)}
                        </div>
                        <p className="cell-sub">
                          {p.resident_unit || p.label_unit} · {p.carrier} · …
                          {p.tracking.slice(-6)}
                        </p>
                        <div className="parcel-card-location">
                          <span className="location-tag">{p.location}</span>
                          <span>{Number(p.weight_lbs)} lb</span>
                        </div>
                        {p.starts_at && (
                          <p className="cell-sub">
                            Handoff: {fmt(p.starts_at)} ET
                          </p>
                        )}
                        {parcelActions(p)}
                      </article>
                    ))}
                  </div>
                  <div className="table-scroll parcel-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Parcel / recipient</th>
                          <th>Location</th>
                          <th>Status</th>
                          <th>Next step</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <button
                                className="parcel-title"
                                onClick={() =>
                                  open({ kind: "detail", parcel: p })
                                }
                              >
                                {p.resident_name || p.label_name}
                                <Icon name="arrow" size={14} />
                              </button>
                              <span className="cell-sub">
                                {p.resident_unit || p.label_unit} · {p.carrier}{" "}
                                · …{p.tracking.slice(-6)}
                              </span>
                            </td>
                            <td>
                              <span className="location-tag">{p.location}</span>
                              <span className="cell-sub">
                                {Number(p.weight_lbs)} lb
                                {p.condition !== "Intact"
                                  ? " · Exterior damage"
                                  : ""}
                              </span>
                            </td>
                            <td>
                              {badge(p.status)}
                              {p.starts_at && (
                                <span className="cell-sub">
                                  {fmt(p.starts_at)}
                                </span>
                              )}
                            </td>
                            <td>{parcelActions(p)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            <div className="bottom-note">
              <Icon name="clock" size={16} />
              {owner
                ? "Pilot time budget: 2–3 hours per day, including intake, delivery, support, and reporting."
                : "Free self-pickup remains available. Delivery requires an open window and resident handoff."}
            </div>
          </>
        )}
        {selected === "Delivery windows" && (
          <>
            <div className="section-note">
              <Icon name="clock" />
              <p>
                One one-hour window per day. Up to 10 stops, 20 standard
                parcels, and 150 lb per window. Requests close 30 minutes before
                the start. No unattended delivery.
              </p>
            </div>
            <div className="window-grid">
              {data.windows.length === 0 ? (
                <div className="panel empty">
                  <h3>No delivery windows yet.</h3>
                  <p>
                    {owner
                      ? "Open the first window after measuring your route."
                      : "The operator will publish availability here."}
                  </p>
                </div>
              ) : (
                data.windows.map((w) => (
                  <article className="panel window-card" key={w.id}>
                    <p className="eyebrow">
                      {fmt(w.starts_at, {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    <h2>
                      {fmt(w.starts_at, { hour: "numeric", minute: "2-digit" })}{" "}
                      – {fmt(w.ends_at, { hour: "numeric", minute: "2-digit" })}
                    </h2>
                    <p>Eastern Time · Resident handoff</p>
                    <div className="capacity-track">
                      <span
                        style={{
                          width: `${(w.booked_stops / w.capacity) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="capacity-meta">
                      <b>
                        {w.booked_stops} / {w.capacity} stops
                      </b>
                      <span>
                        {w.parcel_count} parcels · {w.weight_lbs} lb
                      </span>
                    </div>
                    <small>
                      {new Date(w.cutoff_at) < new Date()
                        ? "Requests closed"
                        : `Requests close ${fmt(w.cutoff_at, { hour: "numeric", minute: "2-digit" })} ET`}
                    </small>
                    {owner && (
                      <div className="manifest">
                        {data.parcels
                          .filter((p) => p.window_id === w.id)
                          .map((p) => (
                            <div key={p.id}>
                              <div>
                                <b>
                                  {p.resident_unit} · {p.resident_name}
                                </b>
                                <small>
                                  {p.location} · …{p.tracking.slice(-6)}
                                </small>
                              </div>
                              {badge(p.status)}
                            </div>
                          ))}
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </>
        )}
        {selected === "Residents" && owner && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Verified residents</h2>
                <p>{data.residents.length} invited to the pilot</p>
              </div>
            </div>
            {data.residents.length === 0 ? (
              <div className="empty">
                <Icon name="people" size={34} />
                <h3>Start with one household.</h3>
                <p>
                  An invitation gives each resident access to their own parcels.
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Resident</th>
                      <th>Unit</th>
                      <th>Account</th>
                      <th>Residency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.residents.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.name}</b>
                          <span className="cell-sub">{r.email}</span>
                        </td>
                        <td>{r.unit}</td>
                        <td>
                          {badge(
                            r.activated ? "Activated" : "Invitation pending",
                          )}
                        </td>
                        <td>
                          {r.verified_at ? (
                            badge("Verified")
                          ) : r.profile_submitted_at ? (
                            <button
                              className="button"
                              onClick={() =>
                                open({ kind: "approve-resident", resident: r })
                              }
                            >
                              Review residency
                            </button>
                          ) : (
                            "Awaiting resident details"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="panel-footnote">
              Invitations are copied and shared manually. To reset a resident
              password, issue a new invitation with the same verified details.
              No email or SMS is sent by this version.
            </p>
          </section>
        )}
        {selected === "Scorecard" && owner && (
          <>
            <section className="stats">
              {[
                { n: data.parcels.length, label: "Parcels received" },
                {
                  n: data.parcels.filter((p) => p.status === "Delivered")
                    .length,
                  label: "Resident handoffs",
                },
                { n: review.length, label: "Open exceptions" },
                {
                  n: data.metrics.reduce((n, m) => n + m.minutes, 0),
                  label: "Operator minutes logged",
                },
              ].map((s) => (
                <div className="stat" key={s.label}>
                  <span>{s.label}</span>
                  <strong>{s.n}</strong>
                  <small>
                    {data.rehearsal
                      ? "Rehearsal records only"
                      : "Current pilot records"}
                  </small>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Daily operating record</h2>
                  <p>
                    Time includes every part of the service. Search time is one
                    recorded sample per day.
                  </p>
                </div>
                <button className="button" onClick={() => window.print()}>
                  Print scorecard
                </button>
              </div>
              {data.metrics.length === 0 ? (
                <div className="empty">
                  <h3>Measure before making promises.</h3>
                  <p>
                    No operating results have been recorded. Record baseline
                    observations before starting service.
                  </p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Total time</th>
                        <th>Staff interruptions</th>
                        <th>Search sample</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.metrics.map((m) => (
                        <tr key={m.day}>
                          <td>{String(m.day).slice(0, 10)}</td>
                          <td>
                            <span
                              className={m.minutes > 180 ? "over-budget" : ""}
                            >
                              {m.minutes} min
                              {m.minutes > 180 ? " · over budget" : ""}
                            </span>
                          </td>
                          <td>{m.interruptions}</td>
                          <td>
                            {m.search_seconds === null
                              ? "Not measured"
                              : `${m.search_seconds}s`}
                          </td>
                          <td>{m.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="panel-footnote">
                No savings, complaint reduction, or service-level improvement is
                claimed without a measured baseline. All figures above are drawn
                from saved records.
              </p>
            </section>
            <section className="panel activity-panel">
              <div className="panel-header">
                <div>
                  <h2>Custody history</h2>
                  <p>
                    Latest 100 events. Earlier records remain in the database.
                  </p>
                </div>
              </div>
              <div className="activity-list">
                {data.events.slice(0, 20).map((e) => (
                  <div className="activity" key={e.id}>
                    <span className="activity-dot" />
                    <div>
                      <b>
                        …{e.tracking.slice(-6)} · {e.to_status}
                      </b>
                      <p>{e.note}</p>
                      <small>
                        {e.actor_name} · {fmt(e.created_at)}
                      </small>
                    </div>
                  </div>
                ))}
                {data.events.length === 0 && (
                  <p className="muted">No custody events yet.</p>
                )}
              </div>
            </section>
          </>
        )}
        <footer className="workspace-footer">
          <span>LIAM CONCIERGE</span>
          <span>
            {data.rehearsal
              ? "Local development · approval pending"
              : "One-month pilot"}{" "}
            · Demonstration community
          </span>
        </footer>
      </main>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setModal(null);
        }}
        onClose={() => {
          if (!busy) setModal(null);
        }}
        className="modal"
      >
        {modal && (
          <>
            <div className="modal-header">
              <div>
                <p className="eyebrow">
                  {modal.parcel?.tracking || "LIAM CONCIERGE"}
                </p>
                <h2>{modalTitle}</h2>
              </div>
              <button
                className="icon-button close-button"
                aria-label="Close dialog"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            {modal.kind === "detail" ? (
              <div className="detail-content">
                <div className="detail-summary">
                  {badge(modal.parcel!.status)}
                  <h3>
                    {modal.parcel!.resident_name || modal.parcel!.label_name}
                  </h3>
                  <p>
                    Verified unit: {modal.parcel!.resident_unit || "Unmatched"}{" "}
                    · Label unit: {modal.parcel!.label_unit}
                  </p>
                  <p>
                    Location: <b>{modal.parcel!.location}</b> ·{" "}
                    {Number(modal.parcel!.weight_lbs)} lb
                  </p>
                  <p>Tracking: {modal.parcel!.tracking}</p>
                  {modal.parcel!.exception_reason && (
                    <p className="error">{modal.parcel!.exception_reason}</p>
                  )}
                </div>
                <h3>Recent custody events</h3>
                {data.events
                  .filter((e) => e.parcel_id === modal.parcel!.id)
                  .map((e) => (
                    <div className="activity" key={e.id}>
                      <span className="activity-dot" />
                      <div>
                        <b>{e.to_status}</b>
                        <p>{e.note}</p>
                        <small>
                          {fmt(e.created_at)} · {e.actor_name}
                        </small>
                      </div>
                    </div>
                  ))}
              </div>
            ) : invite ? (
              <div className="invite-result">
                <span className="success-icon">
                  <Icon name="check" size={30} />
                </span>
                <h3>Invitation ready.</h3>
                <p>
                  Share this private link with the verified resident. It expires
                  in seven days and can be used once. No message has been sent.
                </p>
                <label>
                  Private activation link
                  <textarea readOnly value={invite} rows={3} />
                </label>
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invite);
                      setNotice("Invitation copied.");
                    } catch {
                      setError("Copy the link from the field above.");
                    }
                  }}
                >
                  Copy invitation
                </button>
                {notice && <p role="status">{notice}</p>}
              </div>
            ) : (
              <form
                onSubmit={submit}
                className="modal-form"
                key={`${modal.kind}-${modal.action}-${modal.parcel?.id}`}
              >
                {modal.kind === "intake" && (
                  <>
                    <p className="small muted">
                      Only verified residents appear in the recipient list.
                    </p>
                  </>
                )}
                {modal.kind === "approve-resident" && (
                  <>
                    <p>
                      Verify <strong>{modal.resident!.name}</strong>, apartment{" "}
                      <strong>{modal.resident!.unit}</strong>, using the
                      property-approved residency check. A Google or Apple
                      account does not establish residency.
                    </p>
                    <label>
                      Verification note
                      <textarea
                        name="note"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Record the verification method; do not copy identity documents."
                      />
                    </label>
                    <label className="consent-line">
                      <input type="checkbox" name="confirmed" required />I
                      independently verified this resident and apartment.
                      {data.rehearsal &&
                        " For rehearsal, these are fictional test details."}
                    </label>
                  </>
                )}
                {modal.kind === "intake" && (
                  <>
                    <p className="form-hint">
                      Record only safe, standard loose parcels. Choose a
                      resident only after manually confirming the label. A
                      keyboard-style scanner can type into the tracking field,
                      or use the camera to read a barcode. Always check the
                      printed number.
                    </p>
                    <TrackingInput label="Tracking number" autoFocus />
                    <div className="form-row">
                      <label>
                        Carrier
                        <select name="carrier">
                          {[
                            "Amazon",
                            "UPS",
                            "FedEx",
                            "USPS loose parcel",
                            "Other",
                          ].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Weight (lb)
                        <input
                          name="weight_lbs"
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="25"
                          required
                        />
                      </label>
                      <label>
                        Weight source
                        <select name="weight_source" defaultValue="unverified">
                          <option value="unverified">Not verified</option>
                          <option value="estimate">Estimate</option>
                          <option value="label">Read from label</option>
                          <option value="scale">Measured on scale</option>
                        </select>
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Name on label
                        <input name="label_name" required maxLength={80} />
                      </label>
                      <label>
                        Unit on label
                        <input
                          name="label_unit"
                          required
                          maxLength={30}
                          placeholder="Use Unknown if unclear"
                        />
                      </label>
                    </div>
                    {residentSelect(false)}
                    <div className="form-row">
                      <label>
                        Shelf / location
                        <input
                          name="location"
                          required
                          maxLength={50}
                          placeholder="e.g. Shelf A · 02"
                        />
                      </label>
                      <label>
                        Exterior condition
                        <select name="condition">
                          <option>Intact</option>
                          <option>Visible damage</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Exception note, if any
                      <textarea
                        name="exception_reason"
                        maxLength={500}
                        rows={2}
                      />
                    </label>
                    <label className="checkbox">
                      <input type="checkbox" name="safe_standard" required />I
                      checked that this is a safe standard parcel, at most 25
                      lb, and fits the measured cart and route. No restricted
                      contents are apparent.
                    </label>
                  </>
                )}
                {modal.kind === "invite" && (
                  <>
                    <p className="form-hint">
                      For rehearsal, use a fictional name, unit, and an
                      example.com email address. Live invitations require
                      approved residency verification.
                    </p>
                    <label>
                      Resident name
                      <input name="name" required maxLength={80} />
                    </label>
                    <label>
                      Email address
                      <input
                        type="email"
                        name="email"
                        required
                        maxLength={254}
                      />
                    </label>
                    <label>
                      Building and unit
                      <input
                        name="unit"
                        required
                        maxLength={30}
                        placeholder="e.g. Building 1 · 204"
                      />
                    </label>
                    <label className="checkbox">
                      <input name="verified" type="checkbox" required />I
                      verified this resident and unit through the approved
                      process, or this is a fictional rehearsal identity.
                    </label>
                  </>
                )}
                {modal.kind === "window" && (
                  <>
                    <p className="form-hint">
                      Start with a conservative stop limit. The app reserves one
                      hour and closes requests 30 minutes before departure. One
                      window per Eastern calendar day.
                    </p>
                    <label>
                      Start time in your device’s timezone
                      <input type="datetime-local" name="starts_at" required />
                      <small>
                        {Intl.DateTimeFormat().resolvedOptions().timeZone};
                        saved windows display in Eastern Time.
                      </small>
                    </label>
                    <label>
                      Maximum resident stops
                      <input
                        type="number"
                        name="capacity"
                        min="1"
                        max="10"
                        defaultValue="4"
                        required
                      />
                    </label>
                  </>
                )}
                {modal.kind === "metrics" && (
                  <>
                    <p className="form-hint">
                      Enter the complete total for this date. Saving again
                      replaces that day’s metrics; custody events remain
                      unchanged.
                    </p>
                    <label>
                      Date
                      <input
                        name="day"
                        type="date"
                        defaultValue={today()}
                        max={today()}
                        required
                      />
                    </label>
                    <div className="form-row">
                      <label>
                        Total operator minutes
                        <input
                          name="minutes"
                          type="number"
                          min="0"
                          max="1440"
                          required
                        />
                      </label>
                      <label>
                        Staff interruptions
                        <input
                          name="interruptions"
                          type="number"
                          min="0"
                          max="10000"
                          required
                        />
                      </label>
                    </div>
                    <label>
                      One package-search sample (seconds, optional)
                      <input
                        name="search_seconds"
                        type="number"
                        min="0"
                        max="3600"
                      />
                    </label>
                    <label>
                      Context / baseline notes
                      <textarea name="note" rows={3} maxLength={500} />
                    </label>
                  </>
                )}
                {modal.kind === "schedule" && (
                  <>
                    <p className="form-hint">
                      Be available for a direct handoff in your selected window.
                      Up to three parcels per resident per window. Pricing and
                      resident payments are not enabled in this version.
                    </p>
                    <label>
                      Delivery window
                      <select
                        name="window_id"
                        aria-label="Delivery window"
                        required
                        defaultValue=""
                      >
                        <option value="">Choose an available window</option>
                        {data.windows
                          .filter((w) => new Date(w.cutoff_at) > new Date())
                          .map((w) => (
                            <option value={w.id} key={w.id}>
                              {fmt(w.starts_at)} ET · {w.booked_stops}/
                              {w.capacity} stops
                            </option>
                          ))}
                      </select>
                    </label>
                    {!data.windows.some(
                      (w) => new Date(w.cutoff_at) > new Date(),
                    ) && (
                      <p className="error">
                        No open windows. Free self-pickup remains available.
                      </p>
                    )}
                  </>
                )}
                {modal.kind === "transition" && (
                  <>
                    {modal.action === "resolve" && (
                      <>
                        {residentSelect()}
                        <label>
                          Confirmed shelf / location
                          <input
                            name="location"
                            defaultValue={modal.parcel!.location}
                            required
                            maxLength={50}
                          />
                        </label>
                        <p className="form-hint">
                          If the label conflicts with the resident’s unit,
                          explain how the correct recipient was independently
                          confirmed.
                        </p>
                      </>
                    )}
                    {["load", "deliver", "collect"].includes(modal.action!) && (
                      <TrackingInput label="Scan or re-enter full tracking number" />
                    )}
                    {["deliver", "collect"].includes(modal.action!) && (
                      <label>
                        Confirm building and unit
                        <input
                          name="unit"
                          required
                          maxLength={30}
                          autoComplete="off"
                        />
                      </label>
                    )}
                    {modal.action === "cancel" ? (
                      <p>
                        The parcel will return to Ready status. The resident can
                        collect it or request another available window.
                      </p>
                    ) : (
                      <label>
                        {["resolve", "exception"].includes(modal.action!)
                          ? "Required explanation"
                          : "Additional note (optional)"}
                        <textarea
                          name="note"
                          required={["resolve", "exception"].includes(
                            modal.action!,
                          )}
                          maxLength={500}
                          rows={3}
                        />
                      </label>
                    )}
                    {["resolve", "load", "deliver", "collect"].includes(
                      modal.action!,
                    ) && (
                      <label className="checkbox">
                        <input type="checkbox" name="confirmed" required />
                        {modal.action === "deliver"
                          ? "I verified the recipient’s identity and unit and handed the parcel directly to them."
                          : modal.action === "collect"
                            ? "I verified the collecting resident’s identity and unit before release."
                            : modal.action === "load"
                              ? "I physically verified and loaded this parcel for its assigned window."
                              : "I independently confirmed the recipient and resolved the recorded exception."}
                      </label>
                    )}
                  </>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy
                      ? "Saving…"
                      : modal.kind === "invite"
                        ? "Create private invitation"
                        : modal.kind === "schedule"
                          ? "Request delivery"
                          : "Save record"}
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </dialog>
    </div>
  );
}
