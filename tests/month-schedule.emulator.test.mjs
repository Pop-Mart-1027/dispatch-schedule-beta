import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createMonthScheduleService } from '../functions/month-schedule-service.mjs';
import { createServer } from 'vite';
if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw Error('Emulator required; no production access');
const require = createRequire(
  new URL('../functions/index.js', import.meta.url),
);
const { initializeApp, deleteApp } = require('firebase-admin/app'),
  { getFirestore, FieldValue } = require('firebase-admin/firestore');
const projectId = 'demo-month-layout',
  app = initializeApp({ projectId }, 'layout-test'),
  db = getFirestore(app);
class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const handle = createMonthScheduleService({ db, FieldValue, HttpsError });
let env, moduleServer;
const token = (id, role) => ({
  uid: id,
  token: { employeeId: id, role, mustChangePassword: false },
});
const call = (data, auth = token('ADMIN', 'admin')) =>
  handle({ auth, data: { monthKey: '2026-09', revision: 0, ...data } });
const section=(group,areaCode)=>({key:`area:${areaCode}`,group,section:`${areaCode}區`,areaCode,label:`${areaCode}區`});
before(async () => {
  moduleServer = await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent',
    plugins:[{name:'emulator-only-firebase',enforce:'pre',
      resolveId(source, importer){if(source==='./firebase' && importer?.replaceAll('\\','/').includes('/lib/')) return '\0emulator-firebase';},
      load(id){if(id==='\0emulator-firebase') return 'export const db=undefined, functions=undefined;';},
    }],
  });
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
  await env.clearFirestore();
  const batch = db.batch();
  for (const [id, role] of [
    ['ADMIN', 'admin'],
    ['MON', 'duty'],
    ['P1', 'employee'],
    ['P2', 'employee'],
    ['P3', 'employee'],
  ])
    batch.set(db.collection('employees').doc(id), {
      name: id,
      role,
      active: true,
      mustChangePassword: false,
      group: 'day',
      section: 'A1區',
    });
  for (const id of ['P1', 'P2'])
    for (let day = 1; day <= 30; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      batch.set(db.collection('scheduleRecords').doc(`${id}_${date}`), {
        id: `${id}_${date}`,
        employeeId: id,
        employeeName: id,
        date,
        shiftType: 'morning',
        scheduleCode: day % 7 ? '早A1' : '休',
      });
    }
  batch.set(db.collection('scheduleRecords').doc('P1_2026-08-01'), {
    employeeId: 'P1',
    date: '2026-08-01',
    scheduleCode: '晚B1',
  });
  batch.set(db.doc('scheduleMonthLayouts/2026-09'),{monthKey:'2026-09',revision:0,
    rows:['P1','P2'].map(employeeId=>({employeeId,group:'day',section:'A1區',areaCode:'A1',blankDays:[]})),
    sections:[section('day','A1'),section('day','O1'),section('night','O1')]});
  await batch.commit();
});
after(async () => {
  await moduleServer.close();
  await env.cleanup();
  await deleteApp(app);
});
test('only active matching admin claims can perform row operations; browser writes are denied', async () => {
  for (const auth of [
    token('MON', 'duty'),
    token('P1', 'employee'),
    token('MON', 'admin'),
    {
      uid: 'ADMIN',
      token: { employeeId: 'P1', role: 'admin', mustChangePassword: false },
    },
  ])
    await assert.rejects(
      call({ action: 'remove', employeeId: 'P1', confirmed: true }, auth),
      { code: 'permission-denied' },
    );
  for (const [id, role] of [
    ['ADMIN', 'admin'],
    ['MON', 'duty'],
    ['P1', 'employee'],
  ]) {
    const client = env
      .authenticatedContext(id, {
        employeeId: id,
        role,
        mustChangePassword: false,
      })
      .firestore();
    await assertSucceeds(
      getDoc(doc(client, 'scheduleMonthLayouts', '2026-09')),
    );
    await assertFails(
      setDoc(doc(client, 'scheduleMonthLayouts', '2026-09'), { rows: [] }),
    );
  }
  await assertFails(
    getDoc(
      doc(
        env.unauthenticatedContext().firestore(),
        'scheduleMonthLayouts',
        '2026-09',
      ),
    ),
  );
});
test('month row move updates only original-area working codes; ordering/removal preserve history and audit', async () => {
  const snapshot = async () =>
    (await db.collection('scheduleRecords').orderBy('__name__').get()).docs.map(
      (d) => d.data(),
    );
  const original = await snapshot();
  await call({
    action: 'move',
    employeeId: 'P1',
    group: 'day',
    section: 'O1區',
    areaCode: 'O1',
  });
  let layout = (await db.doc('scheduleMonthLayouts/2026-09').get()).data();
  assert.equal(layout.rows.find((r) => r.employeeId === 'P1').section, 'O1區');
  await assert.rejects(
    call({
      action: 'move',
      employeeId: 'P1',
      group: 'day',
      section: 'A1區',
      areaCode: 'A1',
    }),
    { code: 'aborted' },
  );
  await call({
    revision: 1,
    action: 'move',
    employeeId: 'P2',
    group: 'day',
    section: 'O1區',
    areaCode: 'O1',
  });
  await call({ revision: 2, action: 'up', employeeId: 'P2' });
  const moved = await snapshot();
  for (const record of moved) {
    const before=original.find(r=>r.employeeId===record.employeeId && r.date===record.date);
    assert.equal(record.scheduleCode, before.scheduleCode === '早A1' ? '早O1' : before.scheduleCode);
  }
  layout = (await db.doc('scheduleMonthLayouts/2026-09').get()).data();
  assert.deepEqual(
    layout.rows.map((r) => r.employeeId),
    ['P2', 'P1'],
  );
  await call({ revision: 3, action: 'down', employeeId: 'P2' });
  await assert.rejects(
    call({
      revision: 4,
      action: 'add',
      employeeId: 'P1',
      group: 'day',
      section: 'O1區',
      areaCode: 'O1',
    }),
    /已存在/,
  );
  await assert.rejects(
    call({ revision: 4, action: 'remove', employeeId: 'P1' }),
    /確認/,
  );
  await call({
    revision: 4,
    action: 'remove',
    employeeId: 'P1',
    confirmed: true,
  });
  assert.equal(
    (await db.doc('scheduleMonthLayouts/2026-08').get()).exists,
    false,
  );
  assert.deepEqual(await snapshot(), moved);
  assert.deepEqual((await db.doc('scheduleMonthLayouts/2026-09').get()).data().excludedEmployeeIds,['P1']);
  await call({
    revision: 5,
    action: 'add',
    employeeId: 'P3',
    group: 'night',
    section: 'O1區',
    areaCode: 'O1',
  });
  await call({
    revision: 6,
    action: 'add',
    employeeId: 'P1',
    group: 'day',
    section: 'A1區',
    areaCode: 'A1',
  });
  layout = (await db.doc('scheduleMonthLayouts/2026-09').get()).data();
  assert.equal(
    layout.rows.find((r) => r.employeeId === 'P1').blankDays.length,
    30,
  );
  assert.deepEqual(await snapshot(), moved);
  assert.deepEqual(layout.excludedEmployeeIds,[]);
  const audits = await db.collection('scheduleAuditLogs').get();
  assert.equal(audits.size, 7);
  assert.ok(
    audits.docs.every(
      (d) =>
        d.data().modifiedBy === 'ADMIN' &&
        d.data().modifiedAt &&
        d.data().before &&
        d.data().after,
    ),
  );
  await call({
    revision: 7,
    action: 'cell',
    employeeId: 'P3',
    date: '2026-09-01',
    code: '夜O1',
  });
  assert.equal(
    (await db.doc('scheduleRecords/P3_2026-09-01').get()).data().scheduleCode,
    '夜O1',
  );
  await call({
    revision: 8,
    action: 'cell',
    employeeId: 'P1',
    date: '2026-09-01',
    code: '晚B1',
  });
  assert.equal(
    (await db.doc('scheduleRecords/P1_2026-09-01').get()).data().scheduleCode,
    '晚B1',
  );
  assert.equal(
    (await db.doc('scheduleMonthLayouts/2026-09').get())
      .data()
      .rows.find((r) => r.employeeId === 'P1')
      .blankDays.includes('1'),
    false,
  );
  assert.equal(
    (await db.doc('scheduleRecords/P1_2026-08-01').get()).data().scheduleCode,
    '晚B1',
  );
  assert.equal((await db.collection('employees').get()).size, 5);
});

test('real Firestore readers and assignment follow O1→K1, monthly exclusion and blank re-add', async () => {
  const monthKey='2026-10', id='P3';
  const codes=['夜O1','國上夜O1','小夜O1','國上小夜O1','O1夜21-01','夜O4','休','例','病','事','慰','公','假'];
  const batch=db.batch();
  batch.set(db.doc(`scheduleMonthLayouts/${monthKey}`),{monthKey,revision:0,rows:[{employeeId:id,group:'night',section:'O1區',areaCode:'O1',blankDays:[]}],sections:[section('night','O1'),section('night','K1')],excludedEmployeeIds:[]});
  codes.forEach((code,i)=>{
    const date=`${monthKey}-${String(i+1).padStart(2,'0')}`,recordId=`${id}_${date}`;
    batch.set(db.doc(`scheduleRecords/${recordId}`),{id:recordId,date,employeeId:id,employeeName:id,shiftType:'night',scheduleCode:code,scheduleLabel:code,leaveType:'',source:'fixture',status:'active',note:''});
  });
  const day=`${monthKey}-01`;
  const makeBlock=(area,variant='standard')=>({id:`${day}_${area}_${variant}`,blockId:`${day}_${area}_${variant}`,date:day,shiftType:'night',areaCode:area,areaName:area,variantCode:variant,vehicleNo:area,vehicleType:'',drivers:[],stations:[],assistants:[],workFocus:'原始工作重點',balanceArea:'',note:'',sourceSheet:'fixture',sourceRow:1,status:'active',modifiedBy:''});
  const template=[makeBlock('O1'),makeBlock('K1'),makeBlock('K1','small-night'),makeBlock('O4')];
  const earlier=new Date('2026-01-01T00:00:00Z');
  Object.assign(template[0],{modifiedBy:'ADMIN',modifiedAt:earlier,drivers:[{employeeId:id,employeeName:id}],assistants:[{employeeId:'P2',employeeName:'P2'}]});
  Object.assign(template[1],{modifiedBy:'ADMIN',modifiedAt:earlier,drivers:[{employeeId:'P2',employeeName:'P2'}]});
  template.forEach(block=>batch.set(db.doc(`dispatchBlocks/${block.id}`),block));
  await batch.commit();
  const peopleBefore=(await db.collection('employees').get()).docs.map(d=>({id:d.id,...d.data()}));
  const priorMonthBefore=(await db.collection('scheduleRecords').where('date','<',`${monthKey}-01`).get()).docs.map(d=>d.data());
  const {listScheduleRecords,listMonthScheduleRecords}=await moduleServer.ssrLoadModule('/lib/schedule-firestore.ts');
  const {listDispatchBlocks}=await moduleServer.ssrLoadModule('/lib/dispatch-blocks-firestore.ts');
  const {assignSchedulesToDispatchBlocks}=await moduleServer.ssrLoadModule('/lib/dispatch-schedule-assignment.ts');
  const {monthSections}=await import('../functions/month-schedule-layout.mjs');
  const client=env.authenticatedContext('ADMIN',{employeeId:'ADMIN',role:'admin',mustChangePassword:false}).firestore();
  const people=[{employeeId:id,name:id,title:'調度專員'}];
  const result=await call({monthKey,action:'move',employeeId:id,group:'night',section:'K1區',areaCode:'K1'});
  assert.equal(result.convertedCount,5);
  const read=await listMonthScheduleRecords(monthKey,undefined,client);
  assert.deepEqual(read.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>r.scheduleCode),codes.map((code,i)=>i<5?code.replace('O1','K1'):code));
  const assign=async()=>assignSchedulesToDispatchBlocks({blocks:await listDispatchBlocks(day,client),schedules:await listScheduleRecords(day,undefined,client),employees:people,shift:'night'});
  let assigned=await assign();
  assert.deepEqual(assigned.blocks.find(b=>b.areaCode==='K1'&&b.variantCode==='standard').drivers.map(p=>p.employeeId),['P2',id]);
  assert.equal(assigned.blocks.find(b=>b.areaCode==='O1').drivers.length,0);
  assert.equal(assigned.blocks.find(b=>b.areaCode==='O1').assistants[0].employeeId,'P2');
  assert.equal(assigned.blocks.find(b=>b.areaCode==='K1').workFocus,'原始工作重點');
  const audit=(await db.collection('scheduleAuditLogs').where('monthKey','==',monthKey).get()).docs[0].data();
  assert.equal(audit.fromSection,'O1區');assert.equal(audit.toSection,'K1區');assert.equal(audit.convertedDates.length,5);
  assert.ok(audit.convertedDates.every(change=>change.date.startsWith(monthKey)&&change.before.scheduleCode.includes('O1')&&change.after.scheduleCode.includes('K1')));
  assert.equal(audit.modifiedBy,'ADMIN');assert.ok(audit.modifiedAt);
  // Even a previously saved manual block must not resurrect an excluded person.
  await db.doc(`dispatchBlocks/${template[3].id}`).update({modifiedBy:'ADMIN',modifiedAt:FieldValue.serverTimestamp(),drivers:[{employeeId:id,employeeName:id}]});
  assigned=await assign();
  assert.equal(assigned.blocks.find(b=>b.areaCode==='O4').drivers[0].employeeId,id,'new manual override after the move is authoritative');
  assert.equal(assigned.blocks.find(b=>b.areaCode==='K1').drivers.some(p=>p.employeeId===id),false);
  const rawBeforeRemove=(await db.collection('scheduleRecords').where('date','>=',`${monthKey}-01`).get()).docs.map(d=>d.data());
  await call({monthKey,revision:1,action:'remove',employeeId:id,confirmed:true});
  assert.deepEqual(await listMonthScheduleRecords(monthKey,undefined,client),[]);
  assigned=await assign();assert.equal(assigned.blocks.flatMap(b=>[...b.drivers,...b.stations,...b.assistants]).filter(p=>p.employeeId===id).length,0);
  let layout=(await db.doc(`scheduleMonthLayouts/${monthKey}`).get()).data();
  assert.deepEqual(monthSections(people,'night',layout),[]);
  assert.deepEqual(layout.excludedEmployeeIds,[id]);
  assert.deepEqual((await db.collection('scheduleRecords').where('date','>=',`${monthKey}-01`).get()).docs.map(d=>d.data()),rawBeforeRemove);
  assert.equal((await db.doc(`dispatchBlocks/${template[3].id}`).get()).data().drivers.length,1,'raw manual history is retained');
  await assert.rejects(call({monthKey,revision:2,action:'cell',employeeId:id,date:day,code:'夜K1'}),/有效日期/);
  await call({monthKey,revision:2,action:'add',employeeId:id,group:'night',section:'K1區',areaCode:'K1'});
  assert.deepEqual(await listScheduleRecords(day,undefined,client),[],'old stored codes do not reactivate blank days');
  assert.equal((await assign()).blocks.flatMap(b=>b.drivers).filter(p=>p.employeeId===id).length,0);
  await call({monthKey,revision:3,action:'cell',employeeId:id,date:day,code:'夜K1'});
  assert.equal((await listScheduleRecords(day,undefined,client))[0].scheduleCode,'夜K1');
  assert.ok((await assign()).blocks.find(b=>b.areaCode==='K1'&&b.variantCode==='standard').drivers.some(p=>p.employeeId===id));
  assert.deepEqual(await listScheduleRecords(`${monthKey}-02`,undefined,client),[]);
  assert.deepEqual((await db.collection('employees').get()).docs.map(d=>({id:d.id,...d.data()})),peopleBefore);
  assert.deepEqual((await db.collection('scheduleRecords').where('date','<',`${monthKey}-01`).get()).docs.map(d=>d.data()),priorMonthBefore);
  assert.equal((await db.collection('scheduleAuditLogs').where('monthKey','==',monthKey).get()).size,4);
});

test('duplicate day rejects the entire move without partial code/layout/audit writes',async()=>{
  const monthKey='2026-11',row={employeeId:'P3',group:'night',section:'O1區',areaCode:'O1',blankDays:[]};
  await db.doc(`scheduleMonthLayouts/${monthKey}`).set({monthKey,rows:[row],sections:[section('night','O1'),section('night','K1')],revision:0});
  for(const id of ['first','duplicate'])await db.doc(`scheduleRecords/rollback-${id}`).set({employeeId:'P3',date:`${monthKey}-01`,scheduleCode:'夜O1'});
  const before=(await db.doc(`scheduleMonthLayouts/${monthKey}`).get()).data();
  await assert.rejects(call({monthKey,action:'move',employeeId:'P3',group:'night',section:'K1區',areaCode:'K1'}),/重複班表/);
  assert.deepEqual((await db.doc(`scheduleMonthLayouts/${monthKey}`).get()).data(),before);
  for(const id of ['first','duplicate'])assert.equal((await db.doc(`scheduleRecords/rollback-${id}`).get()).data().scheduleCode,'夜O1');
  assert.equal((await db.collection('scheduleAuditLogs').where('monthKey','==',monthKey).get()).size,0);
});

test('monthly structure operations persist, audit, reject cross-section drag and protect occupied/deleted sections',async()=>{
  const monthKey='2027-01', ref=db.doc(`scheduleMonthLayouts/${monthKey}`);
  const rows=['P1','P2','P3'].map((employeeId,i)=>({employeeId,group:'night',section:i===2?'K1區':'O1區',areaCode:i===2?'K1':'O1',blankDays:[]}));
  await ref.set({monthKey,rows,revision:0,sections:[section('night','O1'),section('night','K1')]});
  for(const row of rows)await db.doc(`scheduleRecords/${row.employeeId}_${monthKey}-01`).set({employeeId:row.employeeId,date:`${monthKey}-01`,scheduleCode:`夜${row.areaCode}`});
  const records=async()=>(await db.collection('scheduleRecords').where('date','==',`${monthKey}-01`).get()).docs.map(d=>d.data());
  const original=await records();
  const run=async(data)=>call({monthKey,revision:(await ref.get()).data().revision,...data});
  for(const auth of [token('MON','monitor'),token('P1','employee')]) await assert.rejects(call({monthKey,action:'section-add',group:'night',label:'支援小隊'},auth),{code:'permission-denied'});
  await assert.rejects(run({action:'reorder',employeeId:'P1',targetEmployeeId:'P3',position:'after'}),/同一區域/);
  await run({action:'reorder',employeeId:'P1',targetEmployeeId:'P2',position:'after'});
  assert.deepEqual((await ref.get()).data().rows.map(r=>r.employeeId),['P2','P1','P3']);
  assert.deepEqual(await records(),original);
  await assert.rejects(call({monthKey,revision:0,action:'section-rename',group:'night',sectionKey:'area:O1',label:'stale'}),{code:'aborted'});
  await run({action:'section-rename',group:'night',sectionKey:'area:O1',label:'藝文車組'});
  let layout=(await ref.get()).data();
  assert.equal(layout.sections[0].label,'藝文車組');
  assert.equal(layout.sections[0].areaCode,'O1');
  assert.deepEqual(await records(),original);
  await assert.rejects(run({action:'section-delete',group:'night',sectionKey:'area:O1',confirmed:true}),/仍有人員/);
  await run({action:'section-add',group:'night',label:'支援小隊'});
  layout=(await ref.get()).data();
  const custom=layout.sections.find(s=>s.label==='支援小隊');assert.equal(custom.areaCode,null);
  await run({action:'move',employeeId:'P1',group:'night',sectionKey:custom.key});
  assert.deepEqual(await records(),original,'no-code move preserves all formal work codes');
  let audits=(await db.collection('scheduleAuditLogs').where('monthKey','==',monthKey).get()).docs.map(d=>d.data());
  const move=audits.find(a=>a.action==='month-row-move');
  assert.equal(move.note,'無區碼移動，班碼未轉換');assert.deepEqual(move.convertedDates,[]);assert.deepEqual(move.resetManualAssignmentDates,[]);
  await assert.rejects(run({action:'section-delete',group:'night',sectionKey:custom.key,confirmed:true}),/仍有人員/);
  await run({action:'remove',employeeId:'P1',confirmed:true});
  await assert.rejects(run({action:'section-delete',group:'night',sectionKey:custom.key}),/再次確認/);
  await run({action:'section-delete',group:'night',sectionKey:custom.key,confirmed:true});
  await assert.rejects(run({action:'move',employeeId:'P2',group:'night',sectionKey:custom.key}),/不存在或已刪除/);
  assert.deepEqual(await records(),original);
  assert.equal((await db.doc('scheduleMonthLayouts/2027-02').get()).exists,false);
  audits=(await db.collection('scheduleAuditLogs').where('monthKey','==',monthKey).get()).docs.map(d=>d.data());
  assert.equal(audits.length,6);assert.ok(audits.every(a=>a.modifiedBy==='ADMIN'&&a.modifiedAt));
  assert.ok(audits.some(a=>a.action==='section-delete'&&a.before.key===custom.key&&a.after===null));
});
