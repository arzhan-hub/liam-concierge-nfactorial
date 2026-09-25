import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { AppError,currentUser,type User } from "../auth.ts";
import { ensureSchema,pool,transaction } from "../db.ts";
import { openResidentMcp } from "./mcp.ts";
import { createResidentGraph } from "./graph.ts";
import { aiConfigured,traced,flushTraces } from "./model.ts";
import { intentSchema,type AssistantView } from "./types.ts";
export async function eligible(session:string){
  const user=await currentUser(session);
  if(!user)throw new AppError("Please sign in.",401);
  if(user.role!=="owner"&&!user.verified_at)throw new AppError("Your residency must be approved first.",403);
  return user;
}
async function runGraph(user:User,session:string,id:string,input:Parameters<Awaited<ReturnType<typeof createResidentGraph>>["invoke"]>[0]) {
  let mcp:Awaited<ReturnType<typeof openResidentMcp>>|undefined;
  try{
    mcp=await openResidentMcp(user,session,id);
    const graph=await createResidentGraph(mcp);
    const state=await traced("resident_concierge",()=>graph.invoke(input,{configurable:{thread_id:id},recursionLimit:16,callbacks:[]}));
    const snapshot=await graph.getState({configurable:{thread_id:id}});
    const pending=snapshot.next.includes("approval");
    const view:AssistantView={id,mode:state.mode,status:pending?"waiting":"complete",answer:state.answer||"",parcels:state.parcels||[],expected:state.expected||[],windows:state.windows||[],sources:state.sources||[],steps:state.steps||[],pending,operation_result:state.operation_result,...(state.result?{result:state.result}:{})};
    await pool().query("UPDATE assistant_runs SET status=$2,result=$3,updated_at=now() WHERE id=$1",[id,view.status,JSON.stringify(view)]);
    return view;
  }catch(error){await pool().query("UPDATE assistant_runs SET status='failed',updated_at=now() WHERE id=$1",[id]);throw error;}
  finally{await mcp?.close();await flushTraces();}
}
export async function startAssistant(session:string,raw:unknown){
  const user=await eligible(session);
  const input=z.object({mode:z.enum(["guided","ai"]),message:z.string().trim().min(1).max(1500),intent:intentSchema.shape.intent.optional(),ai_consent:z.boolean().optional()}).parse(raw);
  if(input.mode==="ai"&&(!input.ai_consent||!aiConfigured()))throw new AppError(input.ai_consent?"AI is not connected yet. Use the guided options.":"Please review how your message is processed before using AI.",input.ai_consent?503:400);
  if(input.mode==="guided"&& !input.intent)throw new AppError("Choose a guided option.");
  const id=randomUUID();
  await pool().query("INSERT INTO assistant_runs(id,user_id,mode,message) VALUES ($1,$2,$3,$4)",[id,user.id,input.mode,input.message]);
  return runGraph(user,session,id,{message:input.message,mode:input.mode,intent:input.intent||"unavailable",language:/[а-яё]/i.test(input.message)?"ru":"en",owner:user.role==="owner",operation_result:{},parcels:[],expected:[],windows:[],sources:[],steps:[],approval_id:null,approved:false,result:null,answer:""});
}
export async function resumeAssistant(session:string,raw:unknown){
  const user=await eligible(session);
  const input=z.object({id:z.uuid(),approved:z.boolean(),parcel_id:z.uuid().optional(),window_id:z.uuid().optional()}).parse(raw);
  const lock=await pool().connect();
  let acquired=false;
  try{
    acquired=(await lock.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok",[`assistant:${input.id}`])).rows[0].ok;
    if(!acquired)throw new AppError("This request is already being processed.",409);
    const row=(await pool().query("SELECT * FROM assistant_runs WHERE id=$1 AND user_id=$2",[input.id,user.id])).rows[0];
    if(!row)throw new AppError("Conversation not found.",404);
    if(row.status==="complete")return row.result as AssistantView;
    // Recover a committed booking if the response/checkpoint was interrupted.
    const prior=(await pool().query("SELECT * FROM assistant_approvals WHERE run_id=$1 AND user_id=$2",[input.id,user.id])).rows[0];
    if(prior?.consumed_at){
      const view={...row.result,status:"complete",pending:false,result:prior.result,answer:"Your delivery request was confirmed. A repeated request has not created another booking."} as AssistantView;
      const parcel=(await pool().query("SELECT status FROM parcels WHERE id=$1",[prior.parcel_id])).rows[0];
      view.parcels=(view.parcels||[]).map(p=>p.id===prior.parcel_id&&parcel?{...p,status:parcel.status}:p);
      await pool().query("UPDATE assistant_runs SET status='complete',result=$2,updated_at=now() WHERE id=$1",[input.id,JSON.stringify(view)]);
      return view;
    }
    if(row.status!=="waiting")throw new AppError("This request could not be completed. No confirmed booking was found. Please check the package dashboard and start a new request.",409);
    let approval:string|null=null;
    if(input.approved){
      const view=row.result as AssistantView;
      if(!input.parcel_id||!input.window_id||!view.parcels.some(p=>p.id===input.parcel_id&&p.status==="Ready")||!view.windows.some(w=>w.id===input.window_id))throw new AppError("Choose one of the displayed ready packages and windows.");
      approval=randomUUID();
      await transaction(async db=>{await db.query("INSERT INTO assistant_approvals(id,run_id,user_id,parcel_id,window_id,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')",[approval,input.id,user.id,input.parcel_id,input.window_id]);});
    }
    return await runGraph(user,session,input.id,new Command({resume:{approved:input.approved,approval_id:approval}}));
  }finally{if(acquired)await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`assistant:${input.id}`]);lock.release();}
}
export async function assistantHistory(session:string){
  const user=await eligible(session);await ensureSchema();
  const rows=(await pool().query("SELECT id,mode,status,message,result,created_at FROM assistant_runs WHERE user_id=$1 AND message NOT LIKE 'Operator tool:%' ORDER BY created_at DESC LIMIT 20",[user.id])).rows;
  return {configured:aiConfigured(),owner:user.role==="owner",runs:rows};
}
