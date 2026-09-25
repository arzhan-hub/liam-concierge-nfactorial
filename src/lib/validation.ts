import { z } from "zod";

const text = (max = 120) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password: z.string().min(12).max(128),
});
export const activation = credentials.extend({
  name: text(80),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const invitation = z.object({
  email: z
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  name: text(80),
  unit: text(30),
  verified: z.literal(true),
});
export const intake = z.object({
  tracking: text(100).transform((x) => x.replace(/\s+/g, "").toUpperCase()),
  carrier: z.enum(["Amazon", "UPS", "FedEx", "USPS loose parcel", "Other"]),
  label_name: text(80),
  label_unit: text(30),
  location: text(50),
  resident_id: uuid.nullable(),
  condition: z.enum(["Intact", "Visible damage"]),
  weight_lbs: z.coerce.number().positive().max(25),
  weight_source: z.enum(["unverified", "estimate", "label", "scale"]).default("unverified"),
  exception_reason: z.string().trim().max(500),
  safe_standard: z.literal(true),
});
export const transition = z.object({
  id: uuid,
  action: z.enum([
    "resolve",
    "load",
    "deliver",
    "collect",
    "exception",
    "cancel",
  ]),
  tracking: z.string().trim().max(100).default(""),
  unit: z.string().trim().max(30).default(""),
  note: z.string().trim().max(500).default(""),
  resident_id: uuid.optional(),
  location: text(50).optional(),
  confirmed: z.boolean().default(false),
});
export const requestDelivery = z.object({ parcel_id: uuid, window_id: uuid });
export const firebaseSignIn = z.object({
  idToken: z.string().min(20).max(12000),
  invitation: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  consent: z.literal(true),
});
export const residentProfile = z.object({
  name: text(80),
  unit: text(30),
  confirmed: z.literal(true),
});
export const residentApproval = z.object({
  id: uuid,
  name: text(80),
  unit: text(30),
  note: text(500),
  confirmed: z.literal(true),
});
export const windowInput = z.object({
  starts_at: z.iso.datetime(),
  capacity: z.coerce.number().int().min(1).max(10),
});
export const metricInput = z.object({
  day: z.iso.date(),
  minutes: z.coerce.number().int().min(0).max(1440),
  interruptions: z.coerce.number().int().min(0).max(10000),
  search_seconds: z.coerce.number().int().min(0).max(3600).nullable(),
  note: z.string().trim().max(500),
});
