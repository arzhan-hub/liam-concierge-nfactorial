"use client";
import { useEffect,useState } from "react";
import type { AssistantView,Intent } from "@/lib/assistant/types";
import "./operations.css";
import "./concierge.css";
type History={configured:boolean;owner:boolean;runs:{id:string;message:string;status:string;result:AssistantView|null}[]};
const when=(s:string)=>new Date(s).toLocaleString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
async function request(action:string,body?:unknown){const res=await fetch(`/api/assistant/${action}`,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});const json=await res.json();if(!res.ok)throw new Error(json.error||"Please try again.");return json;}
export default function ConciergeWorkspace(){
  const [history,setHistory]=useState<History>({configured:false,owner:false,runs:[]}),[view,setView]=useState<AssistantView|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[consent,setConsent]=useState(false),[message,setMessage]=useState("");
  const [parcel,setParcel]=useState(""),[windowId,setWindowId]=useState("");
  async function refresh(){const h:History=await request("history");setHistory(h);return h;}
  useEffect(()=>{let active=true;request("history").then((h:History)=>{if(active){setHistory(h);setView(h.runs.find(r=>r.result)?.result||null);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return ()=>{active=false;};},[]);
  async function start(intent?:Intent["intent"],label?:string){setBusy(true);setError("");setParcel("");setWindowId("");try{setView(await request("start",{mode:intent?"guided":"ai",message:label||message,intent,ai_consent:consent}));setMessage("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Unable to complete your request.");}finally{setBusy(false);}}
  async function confirm(approved:boolean){if(!view)return;setBusy(true);setError("");try{setView(await request("resume",{id:view.id,approved,...(approved?{parcel_id:parcel,window_id:windowId}:{})}));await refresh();}catch(e){setError(e instanceof Error?e.message:"Unable to confirm. Check your package dashboard before retrying.");}finally{setBusy(false);}}
  const ops=view?.operation_result;
  const opRows=ops?.parcels as {id:string;tracking:string;status:string;days_since_intake?:number;reasons?:string[]}[]|undefined;
  const rooms=ops?.rooms as {id:string;room_name:string;occupancy_percent:number|null;inspected_at:string}[]|undefined;
  return <main className="operations-page concierge-page"><header><a href="/">← Package dashboard</a><a href="/mail">Expected packages</a></header>
    <div className="concierge-intro"><span className="liam-avatar" aria-hidden="true">L</span><div><p>Liam Concierge · AI assistant</p><h1>A little help, whenever you need it.</h1></div></div>
    <p>I can check your package records, explain service rules and help you choose a delivery window. Physical service follows the available windows.</p>
    {error&&<p role="alert" className="ops-error">{error}</p>}
    <section><h2>How can I help?</h2><div className="concierge-choices">{([["packages","My packages"],["expected","What am I expecting?"],["windows","Available windows"],["book","Request a delivery"],...(history.owner?[["room","Room occupancy"],["aging","Aging packages"],["exceptions","Package issues"]]:[])] as [Intent["intent"],string][]).map(([intent,label])=><button key={intent} disabled={busy} onClick={()=>void start(intent,label)}>{label}</button>)}</div>
      <p>The buttons work without AI processing.</p><form onSubmit={e=>{e.preventDefault();void start();}}>
        <label>Your message<textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={1500} rows={3} required placeholder="Ask in English or Russian" /></label>
        <label className="ops-confirm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />I agree to send this message to OpenAI for this request. Do not include passwords or sensitive personal information. Raw messages and package details are omitted from external traces.</label>
        <button disabled={busy||!consent||!history.configured||!message.trim()}>Ask Liam Concierge</button>
        {!history.configured&&<p>AI is not connected. You can still use the options above.</p>}
      </form>
    </section>
    <div aria-live="polite" aria-busy={busy}>{busy&&<p role="status">Checking your request…</p>}{view&&<section><h2>{view.pending?"Review your delivery request":"Your concierge"}</h2><p className="concierge-answer">{view.answer}</p>
      {!!view.parcels.length&&<div className="concierge-cards">{view.parcels.map(p=><article key={p.id}><strong>{p.carrier} · {p.tracking}</strong><p>{p.status}</p><small>Recorded location: {p.location}</small></article>)}</div>}
      {!!view.expected.length&&<><h3>Expected references</h3><p>These notices do not mean the concierge has received your package.</p>{view.expected.map((p,i)=><p key={`${p.tracking}-${i}`}>{p.carrier} · {p.tracking} · {p.email_claim}</p>)}</>}
      {!view.pending&&view.windows.map(w=><p key={w.id}>{when(w.starts_at)} – {when(w.ends_at)} ET</p>)}
      {rooms&&<>{rooms.length?rooms.map(r=><p key={r.id}>{r.room_name}: {r.occupancy_percent===null?"capacity unknown":`${r.occupancy_percent}% at last inspection`} · {when(r.inspected_at)} ET</p>):<p>No room inspections recorded.</p>}</>}
      {opRows&&<><p>{String(ops?.total||0)} matching package records.</p>{opRows.map(p=><p key={p.id}>{p.tracking} · {p.status}{p.days_since_intake!==undefined?` · ${p.days_since_intake} days since intake`:""}{p.reasons?` · ${p.reasons.join(", ").replaceAll("_"," ")}`:""}</p>)}</>}
      {view.pending&&<form onSubmit={e=>{e.preventDefault();void confirm(true);}}><div className="ops-fields"><label>Ready package<select aria-label="Ready package" required value={parcel} onChange={e=>setParcel(e.target.value)}><option value="">Choose a package</option>{view.parcels.filter(p=>p.status==="Ready").map(p=><option key={p.id} value={p.id}>{p.tracking}</option>)}</select></label><label>Delivery window<select aria-label="Delivery window" required value={windowId} onChange={e=>setWindowId(e.target.value)}><option value="">Choose a window</option>{view.windows.map(w=><option key={w.id} value={w.id}>{when(w.starts_at)} ET</option>)}</select></label></div><p>Only confirm if you want this package delivered in the selected window. Availability is checked again.</p><button disabled={busy||!parcel||!windowId}>Confirm delivery request</button> <button type="button" disabled={busy} onClick={()=>void confirm(false)}>Not now</button></form>}
      {!!view.sources.length&&<div className="concierge-sources"><h3>Sources · demo rules</h3><p>These demonstration rules do not establish property approval.</p>{view.sources.map(s=><details key={s.id}><summary>{s.title} · page {s.page}</summary><p>{s.text}</p><a href={`/api/policy#page=${s.page}`} target="_blank" rel="noreferrer">Open source PDF</a><small> · {s.version}</small></details>)}</div>}
      <details><summary>Request steps</summary><ol>{view.steps.map((step,i)=><li key={i}>{step}</li>)}</ol><p>Results describe this request; open the package dashboard for refreshed status.</p></details>
    </section>}</div>
    {!!history.runs.length&&<section><h2>Recent requests</h2>{history.runs.filter(r=>r.result).map(r=><button className="concierge-history" key={r.id} disabled={busy} onClick={()=>{setView(r.result);setParcel("");setWindowId("");}}>{r.message} · {r.status}</button>)}</section>}
  </main>;
}
