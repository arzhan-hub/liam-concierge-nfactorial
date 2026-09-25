import { randomBytes } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { pool } from "../db.ts";
import { digest,AppError,type User } from "../auth.ts";

export async function openResidentMcp(user:User,session:string,runId:string) {
  const raw=randomBytes(32).toString("hex");
  await pool().query("DELETE FROM assistant_capabilities WHERE expires_at<now()");
  await pool().query("INSERT INTO assistant_capabilities VALUES ($1,$2,$3,$4,now()+interval '5 minutes')",[digest(raw),user.id,runId,digest(session)]);
  const transport=new StdioClientTransport({command:process.execPath,args:["--experimental-strip-types",path.join(process.cwd(),"scripts/mcp-server.ts")],cwd:process.cwd(),env:{DATABASE_URL:process.env.DATABASE_URL!,LIAM_MCP_CAPABILITY:raw},stderr:"pipe",maxBufferSize:1024*1024});
  const client=new Client({name:"liam-concierge-app",version:"1.0.0"});
  const close=async()=>{await client.close().catch(()=>{});await pool().query("DELETE FROM assistant_capabilities WHERE token_hash=$1",[digest(raw)]);};
  try {await client.connect(transport,{timeout:10000});}catch{await close();throw new AppError("The concierge tools are unavailable. Please try again.",503);}
  return {list:()=>client.listTools(),close,call:async<T>(name:string,args:Record<string,unknown>={}):Promise<T>=>{
    const result=await client.callTool({name,arguments:args},undefined,{timeout:15000});
    const content=result.content as {type:string;text?:string}[];
    const text=content.find(c=>c.type==="text")?.text || "";
    if(result.isError)throw new AppError(text || "Tool request failed.",409);
    return JSON.parse(text) as T;
  }};
}
