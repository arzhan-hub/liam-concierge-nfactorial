// Reads a Google Web OAuth client download locally. Never prints credentials.
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const filename=process.argv[2];
if(!filename){
  console.error('Usage: npm run gmail:setup -- "/absolute/path/to/downloaded-client.json"\nSee GMAIL_SETUP.md. Do not paste credentials in chat.');
  process.exit(1);
}
try {
  const downloaded=JSON.parse(await readFile(path.resolve(filename),"utf8"));
  const web=downloaded.web;
  if(!web || typeof web.client_id!=="string" || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(web.client_id) || typeof web.client_secret!=="string" || !/^[A-Za-z0-9_-]+$/.test(web.client_secret))
    throw new Error("Expected a Google OAuth client of type Web application.");
  const envPath=path.resolve(".env.local");
  const existing=await readFile(envPath,"utf8");
  const expectedProject=existing.match(/^GMAIL_EXPECTED_PROJECT_ID=(.*)$/m)?.[1].trim();
  if(expectedProject && web.project_id!==expectedProject)throw new Error("This client belongs to a different Google Cloud project.");
  const rawOrigin=existing.match(/^APP_URL=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g,"") || "http://localhost:3000";
  const callback=`${new URL(rawOrigin).origin}/api/mail/callback`;
  if(!Array.isArray(web.redirect_uris) || !web.redirect_uris.includes(callback))throw new Error(`Add this Authorized redirect URI to the Web OAuth client and download it again: ${callback}`);
  const previousKey=existing.match(/^MAIL_TOKEN_KEY=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g,"");
  if(previousKey && !/^[a-f0-9]{64}$/i.test(previousKey))throw new Error("Existing MAIL_TOKEN_KEY is invalid. Resolve it explicitly; this script will not rotate an existing encryption key.");
  const values={GMAIL_CLIENT_ID:web.client_id,GMAIL_CLIENT_SECRET:web.client_secret,MAIL_TOKEN_KEY:previousKey||randomBytes(32).toString("hex")};
  const lines=existing.split("\n").filter(line=>!Object.keys(values).some(key=>line.startsWith(`${key}=`)));
  const output=lines.join("\n").trimEnd()+"\n"+Object.entries(values).map(([key,value])=>`${key}=${value}`).join("\n")+"\n";
  const temporary=`${envPath}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary,output,{mode:0o600,flag:"wx"});await rename(temporary,envPath);await chmod(envPath,0o600);
  console.log("Gmail configuration saved locally. No credentials were printed. Restart npm run dev, then sign in as the intended resident and choose Expected packages → Connect Gmail. Each user grants access separately.");
}catch(error){console.error(error instanceof SyntaxError?"Invalid client JSON.":error.code?"Could not read or save local configuration files.":error.message);process.exit(1);}
