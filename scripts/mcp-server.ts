import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getParcels,
  getAvailableWindows,
  requestDelivery,
  capabilityActor,
} from "../src/lib/assistant/tools.ts";
import { AppError } from "../src/lib/auth.ts";
import { pool } from "../src/lib/db.ts";
import {
  operationTools,
  callOperationTool,
} from "../src/lib/assistant/operations-tools.ts";

const capability = process.env.LIAM_MCP_CAPABILITY || "";
const actor = await capabilityActor(capability); // Fail closed before advertising any tools.
const server = new McpServer({ name: "liam-concierge", version: "1.0.0" });
const run = async (fn: () => Promise<unknown>) => {
  try {
    const result = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            e instanceof AppError
              ? e.message
              : "Tool request could not be completed.",
        },
      ],
    };
  }
};
server.registerTool(
  "get_parcels",
  {
    description:
      "Read only the authenticated resident's physically received and expected packages. Email reports are not custody evidence.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(() => getParcels(capability)),
);
server.registerTool(
  "get_available_windows",
  {
    description:
      "List currently available delivery windows. Final capacity is checked atomically at booking.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(() => getAvailableWindows(capability)),
);
server.registerTool(
  "request_delivery",
  {
    description:
      "Book only the package and window in an existing, explicit resident approval. Approval IDs are supplied by the trusted UI, never invented by an LLM.",
    inputSchema: { approval_id: z.uuid() },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  (args) => run(() => requestDelivery(capability, args)),
);
for (const tool of operationTools) {
  if (tool.ownerOnly && actor.role !== "owner") continue;
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args: unknown) =>
      run(() => callOperationTool(capability, tool.name, args)),
  );
}
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => {
  void server.close().finally(() => pool().end());
});
