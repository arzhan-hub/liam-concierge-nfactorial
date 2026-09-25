import { NextRequest,NextResponse } from "next/server";
import { AppError,rateLimit } from "@/lib/auth";
import { startAssistant,resumeAssistant,assistantHistory,eligible } from "@/lib/assistant/service";
import { mailOrigin } from "@/lib/mail";
import { ZodError } from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store, private"}});
async function handle(req:NextRequest,context:{params:Promise<{action:string}>}){
  try{
    const session=req.cookies.get("liam_session")?.value||"",user=await eligible(session);
    const {action}=await context.params;
    if(req.method==="GET"&&action==="history")return reply(await assistantHistory(session));
    if(req.method!=="POST")throw new AppError("Not found.",404);
    if(req.headers.get("origin")!==mailOrigin())throw new AppError("Request origin is not allowed.",403);
    if(!req.headers.get("content-type")?.startsWith("application/json"))throw new AppError("JSON required.",415);
    const reader=req.body?.getReader(),parts:Uint8Array[]=[];let size=0;
    if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>12000){await reader.cancel();throw new AppError("Request is too large.",413);}parts.push(next.value);}
    let body:unknown;try{body=JSON.parse(Buffer.concat(parts).toString("utf8"));}catch{throw new AppError("Invalid JSON.");}
    await rateLimit(`assistant:${user.id}`,30);
    if(action==="start")return reply(await startAssistant(session,body));
    if(action==="resume")return reply(await resumeAssistant(session,body));
    throw new AppError("Not found.",404);
  }catch(error){return reply({error:error instanceof AppError?error.message:error instanceof ZodError?"Please check your request.":"Your concierge could not complete this request. Please try the package dashboard."},error instanceof AppError?error.status:error instanceof ZodError?400:502);}
}
export const GET=handle;export const POST=handle;
