import { classify, embed } from "../src/lib/assistant/model.ts";
import { tracingProvider, shutdownTraces } from "../src/lib/assistant/tracing.ts";
try {
  const result=await classify("Please deliver my package to my apartment.");
  const vectors=await embed(["Fictional demo policy: confirm your delivery window."]);
  console.log(JSON.stringify({provider:tracingProvider(),model:result.model,intent:result.value.intent,embedding_dimensions:vectors.vectors[0].length,usage:result.usage_metadata,trace_id:result.trace_id}));
}catch(e){console.error(e instanceof Error?e.message:"AI connectivity check failed.");process.exitCode=1;}
finally {await shutdownTraces();}
