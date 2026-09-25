import {mkdir,writeFile,access,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
const local=path.resolve('.local'),data=path.join(local,'postgres');
await mkdir(local,{recursive:true,mode:0o700});
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8'});if(r.status!==0)throw new Error(`${cmd} failed. Install PostgreSQL 16 and put its bin directory on PATH. ${r.stderr||''}`);return r.stdout;};
let exists=true;try{await access('.env.local');}catch{exists=false;}
if(!exists){
 const pass=randomBytes(24).toString('hex');
 await writeFile('.env.local',`DATABASE_URL=postgresql://liam_demo:${pass}@127.0.0.1:55433/liam_nfactorial\nAPP_URL=http://localhost:3000\nSETUP_TOKEN=${randomBytes(32).toString('hex')}\nLIVE_OPERATIONS=false\nDEMO_MODE=true\nDEMO_PASSWORD=${randomBytes(18).toString('base64url')}\nFIREBASE_AUTH_ENABLED=false\nAI_MODEL=gpt-4.1-mini-2025-04-14\nAI_TRACING_PROVIDER=langfuse\n`,{mode:0o600,flag:'wx'});
}
process.loadEnvFile('.env.local');
const url=new URL(process.env.DATABASE_URL);
if(process.env.DEMO_MODE!=='true'||url.hostname!=='127.0.0.1'||url.port!=='55433'||url.pathname!=='/liam_nfactorial')throw new Error('Automatic setup only manages the isolated demo database 127.0.0.1:55433/liam_nfactorial. For an existing database, set .env.local manually and use demo:seed.');
let initialized=true;try{await access(path.join(data,'PG_VERSION'));}catch{initialized=false;}
if(!initialized){const pw=path.join(local,'postgres-password');await writeFile(pw,decodeURIComponent(url.password),{mode:0o600});run('initdb',['-D',data,'-U','liam_demo','--auth-host=scram-sha-256','--auth-local=scram-sha-256',`--pwfile=${pw}`]);}
if(spawnSync('pg_ctl',['-D',data,'status'],{stdio:'ignore'}).status!==0)run('pg_ctl',['-D',data,'-l',path.join(local,'postgres.log'),'-o',`-p 55433 -h 127.0.0.1 -k '${local}'`,'-w','start']);
const adminUrl=new URL(url);adminUrl.pathname='/postgres';const client=new pg.Client({connectionString:adminUrl.toString()});await client.connect();
if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='liam_nfactorial'")).rowCount)await client.query('CREATE DATABASE liam_nfactorial');await client.end();
const seed=spawnSync(process.execPath,['--env-file=.env.local','--experimental-strip-types','scripts/seed-demo.ts'],{stdio:'inherit'});if(seed.status!==0)process.exit(seed.status||1);
console.log('Demo ready. Start with npm run dev. Private sign-in details: .local/demo-access.txt.');
