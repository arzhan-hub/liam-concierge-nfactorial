import { NextRequest,NextResponse } from "next/server";
import { currentUser,AppError,rateLimit } from "@/lib/auth";
import { requireOwner } from "@/lib/service";
import { analyzeLabel,confirmLabel } from "@/lib/assistant/vision";
import { flushTraces } from "@/lib/assistant/tracing";
import { mailOrigin } from "@/lib/mail";
import { ZodError } from "zod";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:NextRequest,ctx:{params:Promise<{action:string}>}){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
 try{
  const user=await currentUser(req.cookies.get("liam_session")?.value);if(!user)throw new AppError("Please sign in.",401);requireOwner(user);
  if(req.headers.get("origin")!==mailOrigin())throw new AppError("Request origin is not allowed.",403);
  if(!req.headers.get("content-type")?.startsWith("application/json"))throw new AppError("JSON required.",415);
  await rateLimit(`labels:${user.id}`,20);
  const reader=req.body?.getReader(),parts:Uint8Array[]=[];let size=0;
  if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4250000){await reader.cancel();throw new AppError("Image request is too large.",413);}parts.push(chunk.value);}
  let body:unknown;try{body=JSON.parse(Buffer.concat(parts).toString("utf8"));}catch{throw new AppError("Invalid JSON.");}
  const {action}=await ctx.params;
  if(action==="analyze")return reply(await analyzeLabel(user,body));
  if(action==="confirm")return reply(await confirmLabel(user,body));
  throw new AppError("Not found.",404);
 }catch(e){return reply({error:e instanceof AppError?e.message:e instanceof ZodError?"Check the image, consent and required fields.":"Label request failed. No success is assumed; check the package dashboard before retrying."},e instanceof AppError?e.status:e instanceof ZodError?400:502);}
 finally{await flushTraces();}
}
