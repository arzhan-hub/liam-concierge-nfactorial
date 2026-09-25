"use client";
import { useEffect, useState } from "react";
import "./operations.css";

type Room = {
  id: string;
  room_name: string;
  occupied_slots: number;
  capacity_slots: number | null;
  occupancy_percent: number | null;
  slot_definition: string;
  inspected_at: string;
};
type Parcel = {
  id: string;
  tracking: string;
  status: string;
  location: string;
  days_since_intake?: number;
  reasons?: string[];
  weight_lbs?: number;
  weight_source?: string;
  unit?: string;
};
type Result = {
  parcels?: Parcel[];
  parcel?: Parcel;
  bookings?: Parcel[];
  total?: number;
  truncated?: boolean;
  warnings?: string[];
  weight_note?: string;
  totals?: {
    booked_parcels: number;
    booked_stops: number;
    recorded_weight_lbs: number;
    unverified_weight_parcels: number;
  };
  remaining_capacity?: {
    stops: number;
    parcels: number;
    recorded_weight_lbs: number;
  };
  limits?: { stops: number; parcels: number; weight_lbs: number };
};
type Dashboard = {
  parcels: Parcel[];
  windows: { id: string; starts_at: string }[];
};
const when = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}
const tool = <T,>(name: string, args: Record<string, unknown> = {}) =>
  post<T>("operations-tool", { tool: name, arguments: args });

export default function OperationsWorkspace() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({
    parcels: [],
    windows: [],
  });
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null),
    [resultTitle, setResultTitle] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      tool<{ rooms: Room[] }>("get_room_capacity"),
      fetch("/api/dashboard").then(async (r) => {
        if (!r.ok) throw new Error("Please sign in again.");
        return r.json() as Promise<Dashboard>;
      }),
    ])
      .then(([capacity, data]) => {
        if (active) {
          setRooms(capacity.rooms);
          setDashboard(data);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function inspect(
    name: string,
    title: string,
    args: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      setResult(await tool<Result>(name, args));
      setResultTitle(title);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Check could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post("room-inspection", {
        room_name: data.get("room_name"),
        occupied_slots: Number(data.get("occupied_slots")),
        capacity_slots:
          data.get("capacity_slots") === ""
            ? null
            : Number(data.get("capacity_slots")),
        slot_definition: data.get("slot_definition"),
        inspected_at: new Date().toISOString(),
        confirmed: data.get("confirmed") === "on",
      });
      setNotice(
        "Inspection saved. Occupancy reflects this check, not live activity.",
      );
      form.reset();
      setRooms((await tool<{ rooms: Room[] }>("get_room_capacity")).rooms);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Inspection could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const parcels =
    result?.parcels ||
    (result?.parcel ? [result.parcel] : result?.bookings || []);
  return (
    <main className="operations-page">
      <header>
        <a href="/">← Package dashboard</a>
        <span>Liam Concierge · Operator workspace</span>
      </header>
      <h1>Room &amp; delivery checks</h1>
      <p className="ops-intro">
        Keep a clear record of each room check and prepare the next delivery
        window. Observations do not imply property approval or round-the-clock
        service.
      </p>
      {error && (
        <p role="alert" className="ops-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ops-notice">
          {notice}
        </p>
      )}
      <section aria-labelledby="room-heading">
        <h2 id="room-heading">Last room inspections</h2>
        <p>
          Manual observations. Arrivals and collections between checks may
          change occupancy. All times are Eastern.
        </p>
        <div className="ops-rooms">
          {rooms.map((room) => (
            <article key={room.id} className="ops-room">
              <h3>{room.room_name}</h3>
              <strong>
                {room.occupancy_percent === null
                  ? "Capacity not recorded"
                  : `${room.occupancy_percent}% occupied`}
              </strong>
              <p>
                {room.occupied_slots} occupied
                {room.capacity_slots === null
                  ? ""
                  : ` / ${room.capacity_slots} total`}{" "}
                slots
              </p>
              <p>{room.slot_definition}</p>
              <small>Checked {when(room.inspected_at)}</small>
              {room.occupancy_percent !== null &&
                room.occupancy_percent > 100 && (
                  <p className="ops-error">
                    Above recorded capacity at this inspection.
                  </p>
                )}
            </article>
          ))}
        </div>
        {!rooms.length && (
          <p>
            {busy
              ? "Loading room checks…"
              : "No inspections recorded. Room capacity is unknown."}
          </p>
        )}
        <details>
          <summary>Record a room inspection</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(e.currentTarget);
            }}
          >
            <div className="ops-fields">
              <label>
                Room name
                <input
                  name="room_name"
                  maxLength={80}
                  required
                  placeholder="Overflow package room"
                />
              </label>
              <label>
                Occupied slots
                <input
                  name="occupied_slots"
                  type="number"
                  min={0}
                  max={10000}
                  required
                />
              </label>
              <label>
                Total slots — optional
                <input
                  name="capacity_slots"
                  type="number"
                  min={1}
                  max={10000}
                  placeholder="Leave blank if unknown"
                />
              </label>
              <label>
                What counts as one slot?
                <input
                  name="slot_definition"
                  maxLength={200}
                  required
                  placeholder="Use the same unit for both counts"
                />
              </label>
            </div>
            <label className="ops-confirm">
              <input name="confirmed" type="checkbox" required />I checked this
              room now and both counts use the same definition.
            </label>
            <button disabled={busy}>Save inspection</button>
          </form>
        </details>
      </section>
      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading">Package checks</h2>
        <p>
          Read-only checks. These actions do not send messages, book deliveries
          or change package status.
        </p>
        <div className="ops-actions">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void inspect(
                "get_aging_packages",
                "Packages awaiting collection or delivery",
                { min_days: Number(new FormData(e.currentTarget).get("days")) },
              );
            }}
          >
            <label>
              Days since intake
              <input
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={3}
                required
              />
            </label>
            <button disabled={busy}>Find aging packages</button>
          </form>
          <div>
            <p>
              Unmatched recipients, visible damage, review holds and uncertain
              weights.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void inspect(
                  "get_package_exceptions",
                  "Packages needing attention",
                )
              }
            >
              Find package issues
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void inspect(
                "preview_delivery_round",
                "Delivery window preview",
                { window_id: new FormData(e.currentTarget).get("window") },
              );
            }}
          >
            <label>
              Delivery window
              <select name="window" aria-label="Delivery window" required defaultValue="">
                <option value="" disabled>
                  Choose a window
                </option>
                {dashboard.windows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {when(w.starts_at)}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy || !dashboard.windows.length}>
              Preview delivery round
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void inspect("get_package_details", "Package details", {
                parcel_id: new FormData(e.currentTarget).get("parcel"),
              });
            }}
          >
            <label>
              Package
              <select name="parcel" aria-label="Package" required defaultValue="">
                <option value="" disabled>
                  Choose a package
                </option>
                {dashboard.parcels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.tracking} · {p.status}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy || !dashboard.parcels.length}>
              Check package details
            </button>
          </form>
        </div>
        <div aria-live="polite" aria-busy={busy}>
          {result && (
            <div className="ops-result">
              <h3>{resultTitle}</h3>
              {result.total !== undefined && (
                <p>
                  {result.total} matching packages
                  {result.truncated ? " · showing the first 50" : ""}.
                </p>
              )}
              {result.totals && (
                <>
                  <p>
                    {result.totals.booked_parcels} booked packages ·{" "}
                    {result.totals.booked_stops} stops ·{" "}
                    {result.totals.recorded_weight_lbs} lb recorded
                  </p>
                  <p>
                    Limits: {result.limits?.parcels} packages ·{" "}
                    {result.limits?.stops} stops · {result.limits?.weight_lbs}{" "}
                    lb.
                  </p>
                  <p>
                    Existing bookings only, including completed deliveries. This
                    preview does not reserve capacity.
                  </p>
                </>
              )}
              {result.warnings?.map((w) => (
                <p className="ops-error" key={w}>
                  {w}
                </p>
              ))}
              {result.weight_note && <p>{result.weight_note}</p>}
              <div className="ops-table">
                <table>
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Status</th>
                      <th>Recorded location</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcels.map((p) => (
                      <tr key={p.id}>
                        <td>{p.tracking}</td>
                        <td>{p.status}</td>
                        <td>{p.location}</td>
                        <td>
                          {p.days_since_intake !== undefined
                            ? `${p.days_since_intake} days since intake`
                            : p.reasons
                                ?.map((s) => s.replaceAll("_", " "))
                                .join(", ") ||
                              (p.weight_lbs !== undefined
                                ? `${p.weight_lbs} lb · ${p.weight_source}`
                                : "")}
                          {p.unit ? ` · Unit ${p.unit}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!parcels.length && <p>No packages match this check.</p>}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
