import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const pending=[];
globalThis.__profileLayoutRead=ref=>new Promise((resolve,reject)=>pending.push({ref,resolve,reject}));
const server=await createServer({configFile:false,server:{middlewareMode:true},logLevel:'silent',plugins:[{name:'isolate-layout-read',enforce:'pre',resolveId(id){if(id==='test:layout-sdk')return '\0layout-sdk'},load(id){if(id==='\0layout-sdk')return 'export const doc=(db,collection,id)=>({db,collection,id});export const getDoc=ref=>globalThis.__profileLayoutRead(ref);'},transform(code,id){if(id.replaceAll('\\','/').endsWith('/lib/month-schedule-layout.ts'))return code.replace("from 'firebase/firestore'","from 'test:layout-sdk'")}}]});
after(async()=>{delete globalThis.__profileLayoutRead;await server.close()});
const {getMonthLayout}=await server.ssrLoadModule('/lib/month-schedule-layout.ts');
test('concurrent layout requests share one read; settled snapshots are not cached',async()=>{
 const db={},first=getMonthLayout('2026-09',db),same=getMonthLayout('2026-09',db);assert.equal(first,same);assert.equal(pending.length,1);
 pending.shift().resolve({exists:()=>true,data:()=>({revision:1})});assert.deepEqual(await first,{revision:1});
 const fresh=getMonthLayout('2026-09',db);assert.equal(pending.length,1);pending.shift().resolve({exists:()=>true,data:()=>({revision:2})});assert.deepEqual(await fresh,{revision:2});
});
test('layout failures clear pending entries; different databases and months never share',async()=>{
 const db={},failed=getMonthLayout('2026-09',db);pending.shift().reject(Error('offline'));await assert.rejects(failed,/offline/);
 const retry=getMonthLayout('2026-09',db),otherMonth=getMonthLayout('2026-10',db),otherDb=getMonthLayout('2026-09',{});assert.equal(pending.length,3);
 for(const r of pending.splice(0))r.resolve({exists:()=>false});assert.deepEqual(await Promise.all([retry,otherMonth,otherDb]),[null,null,null]);
});
