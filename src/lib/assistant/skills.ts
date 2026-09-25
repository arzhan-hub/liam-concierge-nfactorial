import { readFile } from "node:fs/promises";
import path from "node:path";
import { traced } from "./tracing.ts";
export async function labelReviewSkill(){
  return traced("skill_liam_parcel_exceptions",async()=>{
    const markdown=await readFile(path.join(process.cwd(),"skills/liam-parcel-exceptions/SKILL.md"),"utf8");
    if(!markdown.startsWith("---\nname: liam-parcel-exceptions\n"))throw new Error("Label review skill is invalid.");
    return markdown.replace(/^---[\s\S]*?---\s*/,"");
  },"tool");
}
