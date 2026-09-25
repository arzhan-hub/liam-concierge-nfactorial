import { writeFile,mkdir } from "node:fs/promises";
const id=process.argv[2];
if(!id||!/^[a-f0-9]{32}$/.test(id))throw new Error("Pass a Langfuse trace ID.");
const response=await fetch(`${process.env.LANGFUSE_BASE_URL||"https://cloud.langfuse.com"}/api/public/traces/${id}`,{headers:{Authorization:`Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")}`},signal:AbortSignal.timeout(15000)});
if(!response.ok){console.error(`Trace verification HTTP ${response.status}`);process.exitCode=1;}
else {const data=await response.json();const safe={id:data.id,name:data.name,observations:(data.observations||[]).map((o:{name:string;type:string})=>({name:o.name,type:o.type})),verified_at:new Date().toISOString()};await mkdir("evals/results",{recursive:true});await writeFile("evals/results/trace-verification.json",JSON.stringify(safe,null,2));console.log(JSON.stringify(safe));}
