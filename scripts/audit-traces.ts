import {writeFile} from 'node:fs/promises';
const base=process.env.LANGFUSE_BASE_URL||'https://cloud.langfuse.com';
const headers={Authorization:`Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64')}`};
const names=['liam.resident_concierge','liam.label_intake_draft','liam.eval_vision-01'];
const results:unknown[]=[];
for(const name of names){
 const response=await fetch(`${base}/api/public/traces?name=${encodeURIComponent(name)}&limit=5`,{headers,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Trace API HTTP ${response.status}`);
 const data=await response.json();
 for(const found of data.data||[]){
  const resp=await fetch(`${base}/api/public/traces/${found.id}`,{headers,signal:AbortSignal.timeout(15000)});if(!resp.ok)throw new Error(`Trace API HTTP ${resp.status}`);
  const trace=await resp.json();
  const observations=(trace.observations||[]).map((o:{name:string;type:string;input:unknown;output:unknown})=>({name:o.name,type:o.type,input_redacted:!o.input||JSON.stringify(o.input).includes('"redacted":true'),output_redacted:!o.output||JSON.stringify(o.output).includes('"redacted":true')}));
  if(observations.some((o:{input_redacted:boolean;output_redacted:boolean})=>!o.input_redacted||!o.output_redacted))throw new Error('A trace payload needs privacy review. Nothing exported.');
  results.push({id:trace.id,name:trace.name,observations});
 }
}
await writeFile('evals/results/trace-audit.json',JSON.stringify({verified_at:new Date().toISOString(),traces:results},null,2));console.log(`Verified ${results.length} real traces with redacted inputs and outputs; no private URLs exported.`);
