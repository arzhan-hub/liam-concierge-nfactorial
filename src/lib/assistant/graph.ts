import { Annotation,StateGraph,START,END,interrupt } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { pool } from "../db.ts";
import { classify,traced } from "./model.ts";
import { policyAnswer } from "./rag.ts";
import type { Intent,ParcelCard,ExpectedCard,WindowCard,Source } from "./types.ts";
import type { openResidentMcp } from "./mcp.ts";

const State=Annotation.Root({
  message:Annotation<string>(),mode:Annotation<"guided"|"ai">(),intent:Annotation<Intent["intent"]>(),language:Annotation<"en"|"ru">(),
  parcels:Annotation<ParcelCard[]>(),expected:Annotation<ExpectedCard[]>(),windows:Annotation<WindowCard[]>(),sources:Annotation<Source[]>(),
  answer:Annotation<string>(),approval_id:Annotation<string|null>(),approved:Annotation<boolean>(),
  owner:Annotation<boolean>(),operation_result:Annotation<Record<string,unknown>>(),
  result:Annotation<{parcel_id:string;window_id:string}|null>(),steps:Annotation<string[]>({reducer:(a,b)=>a.concat(b),default:()=>[]}),
});
type GraphState=typeof State.State;
type Mcp=Awaited<ReturnType<typeof openResidentMcp>>;
let saverPromise:Promise<PostgresSaver>|undefined;
export async function getSaver(){
  return saverPromise ??= (async()=>{
    const schema=(await pool().query("SELECT current_schema() AS name")).rows[0].name as string;
    if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))throw new Error("Invalid checkpoint schema");
    const saver=new PostgresSaver(pool(),undefined,{schema});
    const lock=await pool().connect();
    try{await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[`checkpoint:${schema}`]);await saver.setup();}
    finally{await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`checkpoint:${schema}`]);lock.release();}
    return saver;
  })().catch(error=>{saverPromise=undefined;throw error;});
}
const say=(s:GraphState,en:string,ru:string)=>s.language==="ru"?ru:en;
export async function createResidentGraph(mcp:Mcp) {
  return new StateGraph(State)
    .addNode("classify",async s=>traced("classify_request",async()=>({...(s.mode==="ai"?(await classify(s.message,{},s.owner)).value:{}),steps:[s.mode==="ai"?"AI intent classification":"Guided choice"]})))
    .addNode("operations",async s=>{
      const name=s.intent==="room"?"get_room_capacity":s.intent==="aging"?"get_aging_packages":"get_package_exceptions";
      const operation_result=await traced(`mcp_${name}`,()=>mcp.call<Record<string,unknown>>(name),"tool");
      return {operation_result,answer:say(s,"Here is the recorded operator check. Room occupancy is from the last inspection; aging uses a three-day threshold. No messages were sent or package statuses changed.","Вот результат проверки записей. Заполненность относится к последнему осмотру; порог хранения — три дня. Уведомления не отправлялись, статусы посылок не менялись."),steps:[`MCP: ${name}`]};
    })
    .addNode("packages",async()=>traced("mcp_get_parcels",async()=>({...await mcp.call<{parcels:ParcelCard[];expected:ExpectedCard[]}>("get_parcels"),steps:["MCP: get_parcels"]}),"tool"))
    .addNode("load_windows",async()=>traced("mcp_get_available_windows",async()=>({...await mcp.call<{windows:WindowCard[]}>("get_available_windows"),steps:["MCP: get_available_windows"]}),"tool"))
    .addNode("policy",async s=>{
      if(s.mode!=="ai")return {answer:"The AI knowledge search is not connected in guided mode. Your concierge can help with service rules.",steps:["Guided fallback"]};
      return traced("retrieve_and_answer_policy",async()=>({...await policyAnswer(s.message,s.language),steps:["PDF policy → vector search → cited answer"]}));
    })
    .addNode("refuse",async s=>({answer:say(s,"I can help with your own packages, available delivery windows and service rules. I cannot access another resident's details or confirm physical delivery from a message.","Я могу помочь с вашими посылками, окнами доставки и правилами сервиса. Чужие данные недоступны; сообщение не подтверждает физическую передачу посылки."),steps:["Request outside supported scope"]}))
    .addNode("summarize",async s=>({answer:s.intent==="expected"?say(s,`You have ${s.expected.length} expected package reference(s). These are separate from packages received by your concierge.`,`В вашем списке ${s.expected.length} ожидаемых отправлений. Это отдельные записи от посылок, принятых консьержем.`):s.intent==="windows"?say(s,s.windows.length?"Here are the available windows. Capacity is checked again when you confirm.":"There are no available delivery windows right now.",s.windows.length?"Вот доступные окна. При подтверждении вместимость проверяется повторно.":"Сейчас нет доступных окон доставки."):s.intent==="book"?say(s,!s.parcels.some(p=>p.status==="Ready")?"There are no ready packages to book. An expected package must first be checked in.":!s.windows.length?"Your package is ready, but no delivery window is available. Please check again later.":"Choose a ready package and a delivery window. I will submit the request only after your confirmation.",!s.parcels.some(p=>p.status==="Ready")?"Нет готовых к бронированию посылок. Ожидаемая посылка сначала должна пройти приём.":!s.windows.length?"Посылка готова, но свободных окон пока нет. Проверьте позже.":"Выберите готовую посылку и окно доставки. Заявка будет создана только после подтверждения."):say(s,`Your concierge has ${s.parcels.length} package record(s) for your account. Current statuses are shown below.`,`В вашем аккаунте ${s.parcels.length} записей о принятых посылках. Текущие статусы показаны ниже.`),steps:["Verified data response"]}))
    .addNode("approval",async s=>{
      const decision=z.object({approved:z.boolean(),approval_id:z.uuid().nullable()}).parse(interrupt({kind:"delivery_confirmation",parcels:s.parcels.filter(p=>p.status==="Ready"),windows:s.windows}));
      return {...decision,steps:[decision.approved?"Resident confirmed":"Resident declined"]};
    })
    .addNode("book",async s=>traced("mcp_request_delivery",async()=>{
      const result=await mcp.call<{parcel_id:string;window_id:string}>("request_delivery",{approval_id:s.approval_id});
      return {result,parcels:s.parcels.map(p=>p.id===result.parcel_id?{...p,status:"Scheduled"}:p),answer:say(s,"Your delivery request is confirmed for the selected window.","Ваша заявка подтверждена на выбранное окно доставки."),steps:["MCP: request_delivery"]};
    },"tool"))
    .addNode("cancel",async s=>({answer:say(s,"Nothing was booked. You can choose another window when you are ready.","Бронирование не создано. Вы можете выбрать другое окно позже."),steps:["No booking created"]}))
    .addEdge(START,"classify")
    .addConditionalEdges("classify",s=>["room","aging","exceptions"].includes(s.intent)?s.owner?"operations":"refuse":s.intent==="policy"?"policy":s.intent==="unavailable"?"refuse":s.intent==="windows"?"load_windows":"packages")
    .addConditionalEdges("packages",s=>s.intent==="book"?"load_windows":"summarize")
    .addEdge("load_windows","summarize")
    .addConditionalEdges("summarize",s=>s.intent==="book"&&s.parcels.some(p=>p.status==="Ready")&&s.windows.length?"approval":END)
    .addConditionalEdges("approval",s=>s.approved?"book":"cancel")
    .addEdge("book",END).addEdge("cancel",END).addEdge("policy",END).addEdge("refuse",END).addEdge("operations",END)
    .compile({checkpointer:await getSaver()});
}
