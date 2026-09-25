import { z } from "zod";
import { digest, AppError, type User } from "../auth.ts";
import { pool, transaction } from "../db.ts";
import { scheduleDelivery } from "../service.ts";
import { mailOverview } from "../mail.ts";
import type { ParcelCard, WindowCard } from "./types.ts";
import { DELIVERY_LIMITS } from "../delivery-limits.ts";

export async function capabilityActor(raw: string) {
  if (!/^[a-f0-9]{64}$/.test(raw))
    throw new AppError("Unauthorized MCP session.", 401);
  const row = (
    await pool().query(
      `SELECT u.id,u.email,u.name,u.unit,u.role,u.verified_at,c.run_id FROM assistant_capabilities c
    JOIN users u ON u.id=c.user_id JOIN sessions s ON s.token_hash=c.session_hash AND s.user_id=u.id
    WHERE c.token_hash=$1 AND c.expires_at>now() AND s.expires_at>now()`,
      [digest(raw)],
    )
  ).rows[0] as (User & { run_id: string }) | undefined;
  if (!row || (row.role !== "owner" && !row.verified_at))
    throw new AppError("Unauthorized MCP session.", 401);
  return row;
}
export async function getParcels(capability: string) {
  const user = await capabilityActor(capability);
  // Even operators use their own resident view here. No unrestricted list tool.
  const parcels = (
    await pool().query<ParcelCard>(
      `SELECT id,tracking,carrier,status,received_at,location FROM parcels WHERE resident_id=$1 ORDER BY received_at DESC LIMIT 50`,
      [user.id],
    )
  ).rows;
  const expected = (await mailOverview(user)).deliveries.map((d) => ({
    carrier: d.carrier,
    tracking: d.tracking,
    email_claim: d.email_claim,
    source: d.source,
  }));
  return { parcels, expected };
}
export async function getAvailableWindows(capability: string) {
  const user = await capabilityActor(capability);
  const rows = (
    await pool().query<WindowCard>(
      `SELECT w.id,w.starts_at,w.ends_at,
    greatest(0,w.capacity-count(DISTINCT p.resident_id)::int) AS remaining_stops
    FROM delivery_windows w LEFT JOIN parcels p ON p.window_id=w.id AND p.status IN ('Scheduled','Out for delivery','Delivered')
    WHERE w.cutoff_at>now() GROUP BY w.id
    HAVING (count(DISTINCT p.resident_id)<w.capacity OR count(*) FILTER(WHERE p.resident_id=$1)>0)
    AND count(p.id)<$2 AND coalesce(sum(p.weight_lbs),0)<$3
    AND count(*) FILTER(WHERE p.resident_id=$1)<$4
    ORDER BY w.starts_at LIMIT 20`,
      [
        user.id,
        DELIVERY_LIMITS.parcels,
        DELIVERY_LIMITS.weight_lbs,
        DELIVERY_LIMITS.parcels_per_resident,
      ],
    )
  ).rows;
  return { windows: rows };
}
export async function requestDelivery(capability: string, raw: unknown) {
  const user = await capabilityActor(capability);
  const { approval_id } = z
    .object({ approval_id: z.uuid() })
    .strict()
    .parse(raw);
  return transaction(async (db) => {
    const approval = (
      await db.query(
        `SELECT * FROM assistant_approvals WHERE id=$1 AND user_id=$2 AND run_id=$3 FOR UPDATE`,
        [approval_id, user.id, user.run_id],
      )
    ).rows[0];
    if (!approval)
      throw new AppError("An explicit resident confirmation is required.", 403);
    if (approval.consumed_at) return approval.result;
    if (new Date(approval.expires_at).getTime() <= Date.now())
      throw new AppError(
        "Confirmation expired. Please choose a delivery window again.",
        409,
      );
    // Models cannot supply recipient IDs or create approvals. Recheck ownership
    // here even when the session belongs to an operator.
    if (
      !(
        await db.query("SELECT 1 FROM parcels WHERE id=$1 AND resident_id=$2", [
          approval.parcel_id,
          user.id,
        ])
      ).rowCount
    )
      throw new AppError("Parcel not found.", 404);
    await scheduleDelivery(
      user,
      { parcel_id: approval.parcel_id, window_id: approval.window_id },
      db,
    );
    const result = {
      parcel_id: approval.parcel_id,
      window_id: approval.window_id,
      status: "Scheduled",
    };
    await db.query(
      "UPDATE assistant_approvals SET consumed_at=now(),result=$2 WHERE id=$1",
      [approval.id, JSON.stringify(result)],
    );
    return result;
  });
}
