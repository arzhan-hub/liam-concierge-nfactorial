import { z } from "zod";
import { capabilityActor } from "./tools.ts";
import {
  roomCapacity,
  agingPackages,
  packageDetails,
  packageExceptions,
  previewDeliveryRound,
  agingInput,
  detailsInput,
  exceptionsInput,
  roundInput,
} from "../operations.ts";

export const operationToolNames = [
  "get_room_capacity",
  "get_aging_packages",
  "get_package_details",
  "get_package_exceptions",
  "preview_delivery_round",
] as const;
export const operationTools = [
  {
    name: operationToolNames[0],
    ownerOnly: true,
    schema: z.object({}).strict(),
    description:
      "Operator only. Last manually observed room occupancy, slot definition and inspection time. Not live; unknown capacity is null. Emails and package counts do not establish physical occupancy.",
    run: roomCapacity,
  },
  {
    name: operationToolNames[1],
    ownerOnly: true,
    schema: agingInput,
    description:
      "Operator only. Find parcels still recorded in storage past a chosen age since intake. Excludes out-for-delivery and completed records. Does not send reminders.",
    run: agingPackages,
  },
  {
    name: operationToolNames[2],
    ownerOnly: false,
    schema: detailsInput,
    description:
      "Read package status, recorded location and weight with its declared source. Residents can access only their own package; operators can inspect any recorded package. No inferred weight or carrier lookup.",
    run: packageDetails,
  },
  {
    name: operationToolNames[3],
    ownerOnly: true,
    schema: exceptionsInput,
    description:
      "Operator only. Review active packages with recipient, condition or weight issues. No automatic resolution or notification.",
    run: packageExceptions,
  },
  {
    name: operationToolNames[4],
    ownerOnly: true,
    schema: roundInput,
    description:
      "Operator only. Preview existing bookings for a window with parcel, stop and recorded-weight limits. Does not book, load or deliver packages; uncertain weights are flagged.",
    run: previewDeliveryRound,
  },
];

export async function callOperationTool(
  capability: string,
  name: string,
  input: unknown,
) {
  const user = await capabilityActor(capability);
  const tool = operationTools.find((t) => t.name === name);
  if (!tool) throw new Error("Unknown operation tool");
  return tool.run(user, tool.schema.parse(input));
}
