import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {pool,ensureSchema,transaction} from '../src/lib/db.ts';
import {hashPassword,type User} from '../src/lib/auth.ts';
import {receiveParcel,createWindow} from '../src/lib/service.ts';
import {recordRoomInspection} from '../src/lib/operations.ts';
if(process.env.DEMO_MODE!=='true'||process.env.LIVE_OPERATIONS==='true')throw new Error('Demo seed requires DEMO_MODE=true and LIVE_OPERATIONS=false.');
const password=process.env.DEMO_PASSWORD;
if(!password||password.length<16)throw new Error('Set a random DEMO_PASSWORD of at least 16 characters in .env.local.');
try{
 await ensureSchema();
 const counts=(await pool().query('SELECT count(*)::int AS n FROM users')).rows[0];
 if(counts.n>0 && !(await pool().query("SELECT 1 FROM users WHERE email='owner@example.test' AND role='owner'")).rowCount)throw new Error('Refusing to seed a database containing non-demo users.');
 if(counts.n===0){
  const hash=await hashPassword(password);
  const users:User[]=[{id:randomUUID(),name:'Demo Operator',email:'owner@example.test',unit:null,role:'owner'},{id:randomUUID(),name:'Avery Stone',email:'avery@example.test',unit:'DEMO-101',role:'resident'},{id:randomUUID(),name:'Morgan Reed',email:'morgan@example.test',unit:'DEMO-102',role:'resident'}];
  await transaction(async db=>{for(const u of users)await db.query('INSERT INTO users(id,name,email,unit,role,password_hash,verified_at) VALUES($1,$2,$3,$4,$5,$6,now())',[u.id,u.name,u.email,u.unit,u.role,hash]);});
 }
 const users=(await pool().query<User>("SELECT * FROM users WHERE email IN ('owner@example.test','avery@example.test','morgan@example.test')")).rows;
 const seedOwner=users.find(u=>u.role==='owner')!;
 for(const [i,name,unit,recipient] of [[1,'Avery Stone','DEMO-101',users.find(u=>u.email==='avery@example.test')!.id],[2,'Morgan Reed','DEMO-102',users.find(u=>u.email==='morgan@example.test')!.id],[3,'Unclear name','Unknown',null]] as const){
  if((await pool().query('SELECT 1 FROM parcels WHERE tracking=$1',[`DEMO-PACKAGE-${i}`])).rowCount)continue;
  const p=await receiveParcel(seedOwner,{tracking:`DEMO-PACKAGE-${i}`,carrier:'Other',label_name:name,label_unit:unit,location:`Demo shelf A-${i}`,resident_id:recipient,condition:'Intact',weight_lbs:3,weight_source:'scale',exception_reason:recipient?'':'Recipient requires verification.',safe_standard:true});
  if(i===3)await pool().query("UPDATE parcels SET received_at=now()-interval '5 days' WHERE id=$1",[p.id]);
 }
 if(!(await pool().query('SELECT 1 FROM room_inspections LIMIT 1')).rowCount)await recordRoomInspection(seedOwner,{room_name:'Demo overflow room',occupied_slots:48,capacity_slots:60,slot_definition:'One marked standard-box space',inspected_at:new Date().toISOString(),confirmed:true});
 const owner=(await pool().query<User>("SELECT * FROM users WHERE email='owner@example.test'")).rows[0];
 if(!(await pool().query('SELECT 1 FROM delivery_windows WHERE cutoff_at>now()')).rowCount)await createWindow(owner,{starts_at:new Date(Date.now()+26*3600000).toISOString(),capacity:5});
 await mkdir('.local',{recursive:true,mode:0o700});
 await writeFile('.local/demo-access.txt',`Fictional local demonstration accounts only.\nOperator: owner@example.test\nResident: avery@example.test\nOther resident: morgan@example.test\nPassword (all three): ${password}\nURL: ${process.env.APP_URL||'http://localhost:3000'}\n`,{mode:0o600});
 console.log('Fictional demo accounts, packages, room inspection and delivery window are available.');
}finally{await pool().end();}
