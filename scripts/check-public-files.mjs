import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const env=await readFile('.env.local','utf8').catch(()=>'');
const secrets=env.split('\n').filter(x=>/^(OPENAI_API_KEY|LANGFUSE_SECRET_KEY|LANGSMITH_API_KEY|GMAIL_CLIENT_SECRET|MAIL_TOKEN_KEY|SETUP_TOKEN|DEMO_PASSWORD|DATABASE_URL)=/.test(x)).map(x=>x.slice(x.indexOf('=')+1).trim()).filter(x=>x.length>=16);
const violations=[];
for(const file of [...new Set(files)]){
 const stat=await lstat(file);if(stat.isSymbolicLink()){violations.push({file,reason:'symlink'});continue;}
 if(/^labels\//.test(file)||/(^|\/)(\.env(?!\.example)|\.local|assets|client_secret|backups|node_modules)/.test(file))violations.push({file,reason:'excluded private path'});
 const bytes=await readFile(file);
 if(secrets.some(s=>bytes.includes(Buffer.from(s))))violations.push({file,reason:'local secret match'});
 if(/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{15,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(bytes.toString('utf8')))violations.push({file,reason:'credential pattern'});
}
if(violations.length){console.error(JSON.stringify(violations,null,2));process.exit(1);}
console.log(`PASS: ${new Set(files).size} candidate files; no excluded paths, symlinks, local secret values or recognized credential patterns. This complements manual review, not a proof of all possible data sensitivity.`);
