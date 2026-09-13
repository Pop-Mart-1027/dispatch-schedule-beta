import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPreScheduleService } from '../functions/pre-schedule-service.mjs';
import { monthDays } from '../functions/pre-schedule-domain.mjs';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Firestore emulator required; never use production');
const req=createRequire(new URL('../functions/index.js',import.meta.url));
const {initializeApp,deleteApp}=req('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=req('firebase-admin/firestore');
const app=initializeApp({projectId:'demo-pre-people'},'pre-people-tests'),db=getFirestore(app);
const clock=Date.parse('2026-09-17T00:00:00Z');
class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
const service=createPreScheduleService({db,FieldValue,Timestamp,HttpsError,now:()=>clock});
const role=id=>id==='A1'?'admin':id==='M1'?'duty':'employee';
const invoke=(key,action,values={},id='A1')=>service.handle({auth:{uid:id,token:{employeeId:id,role:role(id),mustChangePassword:false}},data:{monthKey:key,action,...values}});
let number=0;
const seed=async()=>{
  const key=`2027-${String(++number).padStart(2,'0')}`,ref=db.doc(`preScheduleMonths/${key}`);
  await ref.set({monthKey:key,status:'reviewing',openAt:Timestamp.fromMillis(clock-2000),closeAt:Timestamp.fromMillis(clock-1000),publishJob:null});
  const people=['P1','P2'].map(id=>({employeeId:id,name:id,title:'調度專員',group:'day'}));
  await ref.collection('internal').doc('roster').set({people});
  await ref.collection('entries').doc('P1').set({employeeId:'P1',employeeName:'P1',jobTitle:'調度專員',group:'day',days:Array(monthDays(key)).fill('休'),arrangedDays:Array(monthDays(key)).fill(null),note:'preserve',revision:7,submitted:true});
  return {key,ref,people};
};
const mutation=(extra={})=>({mode:'add',employeeId:'N1',group:'day',section:'O1區',beforeId:'',rosterRevision:0,...extra});
before(async()=>{
  for(const id of ['A1','M1','P1','P2','N1','D1','96504'])await db.doc(`employees/${id}`).set({employeeId:id,name:id,title:'調度專員',shiftType:'morning',role:role(id),active:id!=='D1',mustChangePassword:false});
  await db.doc('scheduleRecords/fixture').set({employeeId:'P1',date:'2026-09-01',shiftType:'morning',scheduleCode:'早A1'});
});
after(()=>deleteApp(app));
test('lookup only returns existing active employee and never creates employee data',async()=>{
  const {key}=await seed();
  assert.equal((await invoke(key,'findPerson',{employeeId:'N1'})).person.name,'N1');
  assert.equal((await invoke(key,'findPerson',{employeeId:'UNKNOWN'})).person,null);
  assert.equal((await db.doc('employees/UNKNOWN').get()).exists,false);
  await assert.rejects(invoke(key,'findPerson',{employeeId:'D1'}),e=>e.code==='failed-precondition');
  await assert.rejects(invoke(key,'findPerson',{employeeId:'../N1'}),e=>e.code==='invalid-argument');
});
test('employee and monitor cannot read/manage the full roster or lookup employees',async()=>{
  const {key}=await seed();
  for(const id of ['P1','M1'])for(const action of ['people','findPerson','savePerson'])await assert.rejects(invoke(key,action,mutation(),id),e=>e.code==='permission-denied');
});
test('adding employee changes only this monthly roster, duplicate IDs rejected',async()=>{
  const {key,ref}=await seed();const another=await seed();
  const master=(await db.doc('employees/N1').get()).data();
  const result=await invoke(key,'savePerson',mutation());
  assert.equal(result.revision,1);
  assert.equal((await invoke(key,'group',{group:'day'})).roster.filter(p=>p.employeeId==='N1').length,1);
  await assert.rejects(invoke(key,'savePerson',mutation({rosterRevision:1})),e=>e.code==='already-exists');
  assert.equal((await invoke(another.key,'people')).people.some(p=>p.employeeId==='N1'),false);
  assert.deepEqual((await db.doc('employees/N1').get()).data(),master);
  assert.equal((await ref.collection('entries').doc('N1').get()).exists,false);
  assert.equal((await ref.collection('auditLogs').get()).size,1);
  assert.equal((await db.collection('scheduleRecords').get()).size,1);
});
test('edit area/order/group persists and keeps original schedule cells with audit',async()=>{
  const {key,ref}=await seed();
  const entryBefore=(await ref.collection('entries').doc('P1').get()).data();
  await invoke(key,'savePerson',mutation({mode:'edit',employeeId:'P1',group:'night'}));
  const group=await invoke(key,'group',{group:'night'});
  assert.equal(group.roster[0].employeeId,'P1');assert.equal(group.roster[0].rosterSection,'O1區');
  const entry=(await ref.collection('entries').doc('P1').get()).data();
  assert.deepEqual(entry.days,entryBefore.days);assert.deepEqual(entry.arrangedDays,entryBefore.arrangedDays);assert.equal(entry.note,'preserve');assert.equal(entry.revision,8);
  assert.equal(group.entries[0].group,'night');
  await assert.rejects(invoke(key,'review',{employeeId:'P1',arrangedDays:entry.arrangedDays,note:'stale',revision:7}),e=>e.code==='aborted');
  const summary=await invoke(key,'summary');assert.equal(summary.identityConflicts,0);
});
test('month overrides source group for 96504 without changing source or another month',async()=>{
  const {key}=await seed();
  await invoke(key,'savePerson',mutation({employeeId:'96504',group:'day'}));
  assert.ok((await invoke(key,'group',{group:'day'})).roster.some(p=>p.employeeId==='96504'));
  assert.ok(!(await invoke(key,'group',{group:'night'})).roster.some(p=>p.employeeId==='96504'));
});
test('stale roster revision, missing employee and invalid position cannot overwrite roster',async()=>{
  const {key}=await seed();
  await invoke(key,'savePerson',mutation());
  const before=await invoke(key,'people');
  await assert.rejects(invoke(key,'savePerson',mutation({mode:'edit',employeeId:'P1'})),e=>e.code==='aborted');
  await assert.rejects(invoke(key,'savePerson',mutation({employeeId:'UNKNOWN',rosterRevision:1})),e=>e.code==='not-found');
  await assert.rejects(invoke(key,'savePerson',mutation({mode:'edit',employeeId:'P1',rosterRevision:1,beforeId:'UNKNOWN'})),e=>e.code==='aborted');
  assert.deepEqual(await invoke(key,'people'),before);
});
test('open period, publishing and published month continue to forbid roster edits',async()=>{
  const {key,ref}=await seed();
  await db.doc(`scheduleSettings/${key}`).set({startAt:Timestamp.fromMillis(clock-1000),endAt:Timestamp.fromMillis(clock+60000),status:'open'});
  await assert.rejects(invoke(key,'savePerson',mutation()),e=>e.code==='permission-denied');
  await db.doc(`scheduleSettings/${key}`).update({endAt:Timestamp.fromMillis(clock-1000)});
  for(const update of [{status:'reviewing',publishJob:'fixture-job'},{status:'published',publishJob:null}]){
    await ref.update(update);
    await assert.rejects(invoke(key,'savePerson',mutation()),e=>e.code==='permission-denied');
  }
});
test('two concurrent operations with same revision commit only once',async()=>{
  const {key}=await seed();
  const results=await Promise.allSettled([invoke(key,'savePerson',mutation()),invoke(key,'savePerson',mutation({employeeId:'96504'}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'aborted');
});
