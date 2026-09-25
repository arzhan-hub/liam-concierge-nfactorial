"use client";
import { useState } from "react";
import type { LabelFields } from "@/lib/assistant/vision";
import "./operations.css";
type Draft={id:string;fields:LabelFields;candidates:{id:string;name:string;unit:string}[];issues:string[];branch:string;suggested_resident_id:string|null;barcodes:string[]};
export default function LabelWorkspace(){
 const [photo,setPhoto]=useState(""),[codes,setCodes]=useState<string[]>([]),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
 async function choose(file?:File){if(!file)return;setError("");setDraft(null);setPhoto("");setCodes([]);setSaved(false);setConsent(false);if(file.size>3000000||!["image/png","image/jpeg","image/webp"].includes(file.type)){setError("Choose a PNG, JPEG or WebP image under 3 MB.");return;}setBusy(true);try{
  const image=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);});setPhoto(image);
  try{const {BrowserMultiFormatReader}=await import("@zxing/browser");const decoded=await new BrowserMultiFormatReader().decodeFromImageUrl(image);setCodes([decoded.getText()]);}catch{setCodes([]);}
 }finally{setBusy(false);}}
 async function call(action:string,body:unknown){const r=await fetch(`/api/labels/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
 async function analyze(){setBusy(true);setError("");try{setDraft(await call("analyze",{image:photo,barcodes:codes,ai_consent:consent}));}catch(e){setError(e instanceof Error?e.message:"Unable to read label.");}finally{setBusy(false);}}
 async function confirm(form:HTMLFormElement){if(!draft)return;setBusy(true);setError("");const f=new FormData(form);const v=Object.fromEntries(f);try{await call("confirm",{draft_id:draft.id,confirmed:f.has("confirmed"),parcel:{...v,confirmed:undefined,resident_id:v.resident_id||null,weight_lbs:Number(v.weight_lbs),safe_standard:true}});setSaved(true);setPhoto("");setDraft(null);}catch(e){setError(e instanceof Error?e.message:"Unable to save. Check existing records before retrying.");}finally{setBusy(false);}}
 return <main className="operations-page"><header><a href="/">← Package dashboard</a><span>Liam Concierge · Label review</span></header><h1>Check a package label</h1><p>Read a label, review the suggested fields, then confirm the physical package. Image analysis alone never creates a package record.</p>
 {error&&<p role="alert" className="ops-error">{error}</p>}{saved&&<p role="status" className="ops-notice">Package recorded. <a href="/">Open the package dashboard</a>.</p>}
 <section><h2>Choose a label photo</h2><label>Label image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>void choose(e.target.files?.[0])}/></label>
 {photo&&<img src={photo} alt="Selected label for operator review" style={{maxWidth:"100%",maxHeight:360,objectFit:"contain",marginTop:16}}/>}
 <p>{codes.length?`Decoded on this device: ${codes.join(", ")}. Check whether this is tracking or an internal reference.`:"No barcode decoded. You can still review visible label text."}</p>
 <label className="ops-confirm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I am authorized to process this label and agree to send this image to OpenAI. Use fictional labels for the demonstration. The app does not retain the image or include it in external traces.</label>
 <button disabled={busy||!photo||!consent} onClick={()=>void analyze()}>{busy?"Checking…":"Read label with AI"}</button></section>
 {draft&&<section key={draft.id}><h2>Review before recording</h2>{draft.issues.map(issue=><p key={issue} className="ops-error">{issue}</p>)}
 <p>Suggested text comes from image extraction. The decoded reference is separate. Missing fields remain blank; verify corrections against the physical parcel.</p>
 <form onSubmit={e=>{e.preventDefault();void confirm(e.currentTarget);}}><div className="ops-fields">
 <label>Tracking reference<input name="tracking" required maxLength={100} defaultValue={draft.fields.tracking||""}/></label>
 <label>Carrier<select name="carrier" aria-label="Carrier" defaultValue={draft.fields.carrier}>{["Amazon","UPS","FedEx","USPS loose parcel","Other"].map(c=><option key={c}>{c}</option>)}</select></label>
 <label>Recipient on label<input name="label_name" required maxLength={80} defaultValue={draft.fields.recipient_name||""}/></label>
 <label>Building / unit<input name="label_unit" required maxLength={30} defaultValue={draft.fields.unit||""}/></label>
 <label>Verified recipient<select name="resident_id" aria-label="Verified recipient" defaultValue={draft.suggested_resident_id||""}><option value="">Keep unmatched in review</option>{draft.candidates.map(c=><option value={c.id} key={c.id}>{c.name} · {c.unit}</option>)}</select></label>
 <label>Storage location<input name="location" required maxLength={50}/></label>
 <label>Weight (lb)<input name="weight_lbs" type="number" required min="0.01" max="25" step="0.01" defaultValue={draft.fields.weight_lbs??""}/></label>
 <label>Weight source<select name="weight_source" aria-label="Weight source" defaultValue="unverified"><option value="unverified">Not verified</option><option value="label">I checked the label</option><option value="scale">Measured on scale</option><option value="estimate">Estimate</option></select></label>
 <label>Condition<select name="condition" aria-label="Condition"><option>Intact</option><option>Visible damage</option></select></label>
 <label>Review note<input name="exception_reason" maxLength={500} defaultValue={draft.branch==="confirm"?"":"Label extraction requires human verification."}/></label></div>
 <label className="ops-confirm"><input type="checkbox" name="confirmed" required/>I checked the physical package, corrected the fields, verified any selected recipient, and confirm it is safe, standard and within the 25 lb intake limit.</label>
 <button disabled={busy||draft.branch==="duplicate"}>Confirm package intake</button></form></section>}
 </main>;
}
