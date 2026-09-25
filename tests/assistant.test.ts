import { test,before,after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool,ensureSchema } from "../src/lib/db.ts";
import { newSession,type User } from "../src/lib/auth.ts";
import { startAssistant,resumeAssistant,assistantHistory } from "../src/lib/assistant/service.ts";
import { receiveParcel,createWindow } from "../src/lib/service.ts";
import { assessLabel,confirmLabel,analyzeLabel } from "../src/lib/assistant/vision.ts";
process.env.AI_TRACING_PROVIDER="off";
const original=process.env.DATABASE_URL!,schema=`liam_graph_${randomUUID().replaceAll("-","")}`,admin=new pg.Client({connectionString:original});
const owner:User={id:randomUUID(),name:"Test Owner",email:"owner@example.test",unit:null,role:"owner"};
const alice:User={id:randomUUID(),name:"Test Alice",email:"alice@example.test",unit:"A101",role:"resident"};
const bob:User={id:randomUUID(),name:"Test Bob",email:"bob@example.test",unit:"A102",role:"resident"};
let a:string,b:string,o:string,parcel:string;
before(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);const url=new URL(original);url.searchParams.set("options",`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();await ensureSchema();for(const u of [owner,alice,bob])await pool().query("INSERT INTO users(id,name,email,unit,role,verified_at) VALUES($1,$2,$3,$4,$5,now())",[u.id,u.name,u.email,u.unit,u.role]);a=await newSession(alice.id);b=await newSession(bob.id);o=await newSession(owner.id);
parcel=(await receiveParcel(owner,{tracking:"GRAPH-TEST-1",carrier:"Other",label_name:alice.name,label_unit:alice.unit,resident_id:alice.id,location:"Test shelf",condition:"Intact",weight_lbs:2,weight_source:"scale",exception_reason:"",safe_standard:true})).id;
await createWindow(owner,{starts_at:new Date(Date.now()+86400000).toISOString(),capacity:4});});
after(async()=>{await pool().end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();process.env.DATABASE_URL=original;});
test("LangGraph persists an interrupt, enforces ownership and resumes exactly once",async()=>{
 const started=await startAssistant(a,{mode:"guided",intent:"book",message:"Request delivery"});assert.equal(started.pending,true);assert.ok(started.steps.includes("MCP: get_available_windows"));
 assert.equal((await pool().query("SELECT status FROM parcels WHERE id=$1",[parcel])).rows[0].status,"Ready");
 assert.ok((await pool().query("SELECT count(*)::int AS n FROM checkpoints")).rows[0].n>0);
 assert.equal((await assistantHistory(a)).runs[0].result.pending,true);
 await assert.rejects(()=>resumeAssistant(b,{id:started.id,approved:true,parcel_id:parcel,window_id:started.windows[0].id}),/not found/);
 const input={id:started.id,approved:true,parcel_id:parcel,window_id:started.windows[0].id};
 const completed=await resumeAssistant(a,input);assert.equal(completed.pending,false);assert.equal(completed.result?.parcel_id,parcel);
 assert.deepEqual(await resumeAssistant(a,input),completed);
 assert.equal((await pool().query("SELECT count(*)::int AS n FROM events WHERE parcel_id=$1 AND to_status='Scheduled'",[parcel])).rows[0].n,1);
});
test("guided operator intents cannot expose room or package information to residents",async()=>{
 const denied=await startAssistant(a,{mode:"guided",intent:"room",message:"Room occupancy"});assert.ok(denied.steps.includes("Request outside supported scope"));assert.deepEqual(denied.operation_result,{});
 const allowed=await startAssistant(o,{mode:"guided",intent:"room",message:"Room occupancy"});assert.ok(allowed.steps.includes("MCP: get_room_capacity"));
});
test("no ready packages ends without confirmation, and AI needs consent/configuration",async()=>{
 const none=await startAssistant(b,{mode:"guided",intent:"book",message:"Deliver"});assert.equal(none.pending,false);assert.match(none.answer,/no ready packages/);
 await assert.rejects(()=>startAssistant(a,{mode:"ai",message:"Deliver",ai_consent:false}),/review/);
 await assert.rejects(()=>startAssistant(a,{mode:"ai",message:"Deliver",ai_consent:true}),/not connected/);
});
test("label assessment keeps missing/conflicting fields in review",()=>{
 const fields={readable:true,tracking:"TBA123456789012",carrier:"Amazon" as const,recipient_name:alice.name,unit:alice.unit!,weight_lbs:5};
 const roster=[{id:alice.id,name:alice.name,unit:alice.unit!}];
 assert.equal(assessLabel(fields,roster).branch,"confirm");
 assert.equal(assessLabel({...fields,unit:null},roster).branch,"review");
 assert.equal(assessLabel(fields,roster,["TBA999999999999"]).branch,"review");
 assert.equal(assessLabel({...fields,weight_lbs:32},roster).branch,"review");
 assert.equal(assessLabel({...fields,readable:false},roster).branch,"retake");
 assert.equal(assessLabel(fields,roster,[],true).branch,"duplicate");
});
test("label intake requires operator confirmation and retries return the original receipt",async()=>{
 await assert.rejects(()=>analyzeLabel(alice,{}),/Owner access/);
 await assert.rejects(()=>analyzeLabel(owner,{image:"https://example.test/photo",ai_consent:true}));
 const id=randomUUID();await pool().query("INSERT INTO label_drafts(id,user_id,extracted,result) VALUES($1,$2,'{}','{}')",[id,owner.id]);
 const input={draft_id:id,confirmed:true,parcel:{tracking:"LABEL-TEST-1",carrier:"Other",label_name:alice.name,label_unit:alice.unit,resident_id:alice.id,location:"Test shelf",condition:"Intact",weight_lbs:2,weight_source:"scale",exception_reason:"",safe_standard:true}};
 await assert.rejects(()=>confirmLabel(owner,{...input,confirmed:false}));
 const [one,two]=await Promise.all([confirmLabel(owner,input),confirmLabel(owner,input)]);assert.deepEqual(one,two);
 assert.equal((await pool().query("SELECT count(*)::int AS n FROM parcels WHERE tracking='LABEL-TEST-1'")).rows[0].n,1);
});
test("declining a persisted delivery approval leaves the package Ready",async()=>{
 const start=await startAssistant(a,{mode:"guided",intent:"book",message:"Another delivery"});assert.equal(start.pending,true);
 const end=await resumeAssistant(a,{id:start.id,approved:false});assert.equal(end.pending,false);assert.match(end.answer,/Nothing was booked/);
 assert.equal((await pool().query("SELECT status FROM parcels WHERE tracking='LABEL-TEST-1'")).rows[0].status,"Ready");
});
