import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startActiveObservation, getActiveTraceId, type LangfuseObservationAttributes } from "@langfuse/tracing";
import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";

process.env.LANGSMITH_HIDE_INPUTS = "true";
process.env.LANGSMITH_HIDE_OUTPUTS = "true";
process.env.LANGSMITH_TRACING = "false"; // Explicit redacted tracing only.
export function tracingProvider(): "langfuse" | "langsmith" | "off" {
  const preferred = process.env.AI_TRACING_PROVIDER;
  if (preferred === "off") return "off";
  if (preferred !== "langsmith" && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) return "langfuse";
  return process.env.LANGSMITH_API_KEY ? "langsmith" : "off";
}
// Next.js route bundles can load this module more than once. Keep a single
// exporter per Node process so every route flushes the registered provider.
const globals=globalThis as unknown as {liamTracing?:{processor?:LangfuseSpanProcessor;sdk?:NodeSDK;smith?:Client}};
const tracingState=globals.liamTracing??={};
export function traceClient() {
  return tracingState.smith ??= new Client({apiKey:process.env.LANGSMITH_API_KEY,workspaceId:process.env.LANGSMITH_WORKSPACE_ID,timeout_ms:10000,
    hideInputs:()=>({redacted:true}),hideOutputs:o=>({redacted:true,usage_metadata:o.usage_metadata}),
    anonymizer:v=>"error" in v?{error:"Operation failed; private details omitted."}:v});
}
function init() {
  if (tracingState.sdk) return;
  tracingState.processor = new LangfuseSpanProcessor({publicKey:process.env.LANGFUSE_PUBLIC_KEY,secretKey:process.env.LANGFUSE_SECRET_KEY,
    baseUrl:process.env.LANGFUSE_BASE_URL,mediaUploadEnabled:false,timeout:10,
    shouldExportSpan:({otelSpan})=>otelSpan.name.startsWith("liam.")});
  tracingState.sdk = new NodeSDK({spanProcessors:[tracingState.processor],autoDetectResources:false});tracingState.sdk.start();
}
type Kind="chain"|"tool"|"llm"|"embedding";
export async function traced<T>(name:string,fn:()=>Promise<T>,kind:Kind="chain",metadata:Record<string,string|number>={}) : Promise<T> {
  const provider=tracingProvider();
  if(provider==="off")return fn();
  if(provider==="langsmith")return traceable(fn,{name,run_type:kind,client:traceClient(),project_name:process.env.LANGSMITH_PROJECT||"liam-concierge-nfactorial",tracingEnabled:true,
    metadata,processInputs:()=>({redacted:true}),processOutputs:o=>({redacted:true,usage_metadata:(o as {usage_metadata?:unknown})?.usage_metadata})})();
  init();
  let failure:{error:unknown}|undefined;
  const invoke=async(span:{update:(attributes:LangfuseObservationAttributes)=>unknown})=>{
    span.update({input:{redacted:true},metadata,version:"liam-v2",...(typeof metadata.model==="string"?{model:metadata.model,modelParameters:metadata}:{})});
    try {
      const result=await fn();
      const usage=(result as {usage_metadata?:{input_tokens:number;output_tokens?:number}}|null)?.usage_metadata;
      span.update({output:{redacted:true,completed:true},...(usage?{usageDetails:{input:usage.input_tokens,output:usage.output_tokens||0}}:{})});
      return result;
    } catch(error) {span.update({level:"ERROR",statusMessage:"Operation failed; private details omitted.",output:{redacted:true,completed:false}});failure={error};return undefined as T;}
  };
  // Return inside the observation, then rethrow outside it so SDK status/error
  // instrumentation cannot export the original exception message.
  const result=kind==="llm"?await startActiveObservation(`liam.${name}`,invoke,{asType:"generation"})
    :kind==="embedding"?await startActiveObservation(`liam.${name}`,invoke,{asType:"embedding"})
    :kind==="tool"?await startActiveObservation(`liam.${name}`,invoke,{asType:"tool"})
    :await startActiveObservation(`liam.${name}`,invoke,{asType:"chain"});
  if(failure)throw failure.error;
  return result;
}
export const activeTraceId=()=>tracingProvider()==="langfuse"?getActiveTraceId():undefined;
export async function flushTraces() {if(tracingState.processor)await tracingState.processor.forceFlush();if(tracingState.smith)await tracingState.smith.awaitPendingTraceBatches();}
export async function shutdownTraces(){await flushTraces();await tracingState.sdk?.shutdown();}
