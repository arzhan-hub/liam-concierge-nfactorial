import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,copyFile} from 'node:fs/promises';
import {pool} from '../src/lib/db.ts';
import {newSession} from '../src/lib/auth.ts';
if(process.env.DEMO_MODE!=='true')throw new Error('Use only the isolated fictional demo database.');
const base='http://localhost:3002';
const user=(await pool().query("SELECT id FROM users WHERE email='avery@example.test' AND name='Avery Stone' AND role='resident'")).rows[0];
if(!user)throw new Error('Run demo:setup first.');
const session=await newSession(user.id);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3002'],{env:{...process.env,APP_URL:base},stdio:'ignore'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));if(i===99)throw new Error('Demo server did not start.');}
 browser=await chromium.launch({channel:'chrome',headless:true});
 await mkdir('tmp/demo-video',{recursive:true});
 const context=await browser.newContext({viewport:{width:1280,height:960},recordVideo:{dir:'tmp/demo-video',size:{width:1280,height:960}}});
 await context.addCookies([{name:'liam_session',value:session,url:base,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();
 await page.goto(`${base}/concierge`);await page.getByRole('heading',{name:'How can I help?'}).waitFor();
 await page.waitForTimeout(1500);
 await page.getByRole('button',{name:'Request a delivery',exact:true}).click();
 await page.getByRole('heading',{name:'Review your delivery request'}).waitFor();
 await page.getByRole('heading',{name:'Review your delivery request'}).scrollIntoViewIfNeeded();await page.waitForTimeout(2000);
 await page.reload();await page.getByRole('heading',{name:'Review your delivery request'}).waitFor();
 await page.getByLabel('Ready package',{exact:true}).selectOption({index:1});await page.getByLabel('Delivery window',{exact:true}).selectOption({index:1});
 await page.waitForTimeout(1500);await page.getByRole('button',{name:'Confirm delivery request',exact:true}).click();
 await page.getByText('Your delivery request is confirmed for the selected window.',{exact:true}).waitFor();await page.getByText('Your delivery request is confirmed for the selected window.',{exact:true}).scrollIntoViewIfNeeded();await page.waitForTimeout(2500);
 await page.getByLabel('Your message',{exact:true}).fill('Do I need Gmail to use delivery?');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Ask Liam Concierge',exact:true}).click();
 await page.getByRole('heading',{name:'Sources · demo rules',exact:true}).waitFor({timeout:60000});await page.getByRole('heading',{name:'Sources · demo rules',exact:true}).scrollIntoViewIfNeeded();
 await page.getByText(/Liam Concierge demo policy · page 7/).click();
 await page.waitForTimeout(3000);
 if((await context.request.get(`${base}/defense/Liam_Concierge_nFactorial.pdf`)).status()!==200)throw new Error('Defense PDF unavailable.');
 const video=page.video();await context.close();await mkdir('docs/demo',{recursive:true});await copyFile(await video!.path(),'docs/demo/resident-demo.webm');
 console.log('Recorded fictional guided booking and real AI/RAG answer. No login/password screen recorded.');
}finally{await browser?.close();server.kill('SIGTERM');await pool().query('DELETE FROM sessions WHERE token_hash=encode(sha256($1::bytea),\'hex\')',[Buffer.from(session)]);await pool().end();}
