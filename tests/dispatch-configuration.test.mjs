import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
const server=await createServer({configFile:false,server:{middlewareMode:true},logLevel:'silent'})
after(()=>server.close())
const {resolveDispatchConfiguration,followingDate}=await server.ssrLoadModule('/lib/dispatch-configuration.ts')
const {assignSchedulesToDispatchBlocks}=await server.ssrLoadModule('/lib/dispatch-schedule-assignment.ts')
const block={id:'2026-09-11_night_a',blockId:'2026-09-11_night_a',date:'2026-09-11',shiftType:'night',areaCode:'O1',areaName:'O1區',variantCode:'standard',vehicleNo:'OLD',vehicleType:'',drivers:[],stations:[],assistants:[],workFocus:'old',balanceArea:'',note:'',sourceSheet:'test',sourceRow:1,status:'active',modifiedBy:''}
const base={activeFrom:'2026-09-11',blocks:[block]}
const values={areaName:'新版 O1',vehicleNo:'NEW',drivers:[],stations:[],assistants:[],workFocus:'new',balanceArea:'',note:''}
const version={id:'v1',slot:'night_a',effectiveFrom:'2026-09-12',values,manualPeople:false,modifiedBy:'admin',createdAt:{seconds:1}}
test('vehicle-only versions preserve automatic rosters, chronology and raw history',()=>{
  const snapshot=structuredClone(base)
  assert.deepEqual(resolveDispatchConfiguration('2026-09-10',[block],base,[version]),[block])
  assert.equal(resolveDispatchConfiguration('2026-09-11',[],base,[version])[0].vehicleNo,'OLD')
  const future=resolveDispatchConfiguration('2026-09-12',[],base,[version])
  assert.equal(future[0].vehicleNo,'NEW');assert.equal(future[0].modifiedBy,'')
  const r=assignSchedulesToDispatchBlocks({blocks:future,schedules:[{employeeId:'e',scheduleCode:'O1',shiftType:'night'}],employees:[{employeeId:'e',name:'員工',title:'PT-支援'}],shift:'night'})
  assert.equal(r.blocks[0].stations[0].employeeId,'e')
  const v2={...version,id:'v2',effectiveFrom:'2026-09-15',values:{...values,vehicleNo:'V2'}}
  assert.equal(resolveDispatchConfiguration('2026-09-14',[],base,[v2,version])[0].vehicleNo,'NEW')
  assert.equal(resolveDispatchConfiguration('2026-09-15',[],base,[v2,version])[0].vehicleNo,'V2')
  assert.deepEqual(base,snapshot)
  assert.equal(followingDate('2026-09-30'),'2026-10-01')
})
test('daily manual overrides and personnel versions keep highest priority',()=>{
  const manual={...block,date:'2026-09-12',modifiedBy:'operator',vehicleNo:'TEMP',stations:[{employeeId:'manual',employeeName:'人工'}]}
  assert.deepEqual(resolveDispatchConfiguration('2026-09-12',[manual],base,[version]),[manual])
  const staff={...version,manualPeople:true,values:{...values,stations:[{employeeId:'fixed',employeeName:'固定人員'}]}}
  const future=resolveDispatchConfiguration('2026-09-12',[],base,[staff])
  const r=assignSchedulesToDispatchBlocks({blocks:future,schedules:[{employeeId:'auto',scheduleCode:'O1',shiftType:'night'}],employees:[],shift:'night'})
  assert.deepEqual(r.blocks[0].stations,staff.values.stations)
  assert.equal(r.blocks[0].modifiedBy,'admin')
})

test('renamed area controls next-day display sorting without rewriting history or operational fields',async()=>{
  const {dispatchAreaCodes,dispatchAreaDisplay,dispatchBlockFrontOrder}=await server.ssrLoadModule('/lib/dispatch-area.ts');
  const other={...block,id:'2026-09-11_night_b',blockId:'2026-09-11_night_b',areaCode:'R',areaName:'R區',vehicleNo:'SECOND'};
  const input={...base,blocks:[block,other]},snapshot=structuredClone(input);
  const renamed={...version,values:{...values,areaName:'X1區'}};
  const project=rows=>rows.map(b=>dispatchAreaDisplay(b,dispatchAreaCodes(rows))).sort(dispatchBlockFrontOrder);
  assert.deepEqual(project(resolveDispatchConfiguration('2026-09-11',[],input,[renamed])).map(b=>b.areaCode),['O1','R']);
  const future=resolveDispatchConfiguration('2026-09-12',[],input,[renamed]);
  assert.deepEqual(project(future).map(b=>b.areaCode),['R','X1']);
  assert.equal(future[0].areaCode,'O1');assert.equal(future.length,2);
  const before=structuredClone(future);project(future);assert.deepEqual(future,before);assert.deepEqual(input,snapshot);
});
