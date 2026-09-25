import { NextRequest,NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentUser } from "@/lib/auth";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  const user=await currentUser(req.cookies.get("liam_session")?.value);
  if(!user || (user.role!=="owner"&&!user.verified_at))return NextResponse.json({error:"Please sign in with an approved account."},{status:403});
  const data=await readFile(path.join(process.cwd(),"knowledge/liam-demo-policy.pdf"));
  return new NextResponse(data,{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=liam-demo-policy.pdf","Cache-Control":"private, no-store"}});
}
