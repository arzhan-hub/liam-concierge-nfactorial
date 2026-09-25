import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentUser, AppError } from "./auth.ts";
import { pool } from "./db.ts";
import { requireOwner } from "./service.ts";
import { openResidentMcp } from "./assistant/mcp.ts";
import { operationToolNames } from "./assistant/operations-tools.ts";

// This is a protocol-backed operator workspace, independent of LLM availability.
// Tool choice is explicit in the UI. Models do not receive room/recipient data.
export async function inspectThroughMcp(session: string, raw: unknown) {
  const user = await currentUser(session);
  if (!user) throw new AppError("Please sign in.", 401);
  requireOwner(user);
  const input = z
    .object({
      tool: z.enum(operationToolNames),
      arguments: z.record(z.string(), z.unknown()).default({}),
    })
    .strict()
    .parse(raw);
  const id = randomUUID();
  await pool().query(
    "INSERT INTO assistant_runs(id,user_id,mode,message) VALUES ($1,$2,'guided',$3)",
    [id, user.id, `Operator tool: ${input.tool}`],
  );
  let mcp: Awaited<ReturnType<typeof openResidentMcp>> | undefined;
  try {
    mcp = await openResidentMcp(user, session, id);
    const result = await mcp.call(input.tool, input.arguments);
    await pool().query(
      "UPDATE assistant_runs SET status='complete',updated_at=now() WHERE id=$1",
      [id],
    );
    return result;
  } catch (error) {
    await pool().query(
      "UPDATE assistant_runs SET status='failed',updated_at=now() WHERE id=$1",
      [id],
    );
    throw error;
  } finally {
    await mcp?.close();
  }
}
