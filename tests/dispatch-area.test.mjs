import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { after } from 'node:test'
import { createServer } from 'vite'
const server = await createServer({configFile:false,server:{middlewareMode:true},logLevel:'silent'})
after(()=>server.close())
const {normalizeDispatchAreaCode,dispatchAreaCodes,dispatchAreaDisplay} = await server.ssrLoadModule('/lib/dispatch-area.ts')
const {assignSchedulesToDispatchBlocks} = await server.ssrLoadModule('/lib/dispatch-schedule-assignment.ts')
const blocks=JSON.parse(readFileSync('output/dispatch-blocks-20260909-simulation.json','utf8')).blocks.map(b=>({...b,id:b.blockId}))

test('Z prefix requires a verified destination; explicit official Z codes remain intact',()=>{
  for(const code of ['O1','R','R3','K3','K4','L1','L2','L3','L4','U','W1'])assert.equal(normalizeDispatchAreaCode('Z'+code),code)
  assert.equal(normalizeDispatchAreaCode('ZH',dispatchAreaCodes(blocks)),'H')
  for(const code of ['ZONE','ZQ99','ZZO1','Z'])assert.equal(normalizeDispatchAreaCode(code),code)
  assert.equal(normalizeDispatchAreaCode('ZO1',new Set(['ZO1','O1'])),'ZO1')
})

test('display groups O1 vehicles but retains every block and all operational fields',()=>{
  const before=structuredClone(blocks),valid=dispatchAreaCodes(blocks)
  const result=blocks.map(b=>dispatchAreaDisplay(b,valid))
  assert.equal(result.length,blocks.length)
  result.forEach((b,i)=>{
    const {areaCode,areaName,...rest}=b
    const {areaCode:oldCode,areaName:oldName,...original}=blocks[i]
    assert.deepEqual(rest,original)
  })
  const o1=result.filter(b=>b.shiftType==='night'&&b.areaCode==='O1')
  assert.deepEqual(o1.map(b=>b.vehicleNo.replaceAll('-','')).sort(),['BKP0190','RFW7651','RFX6095'])
  assert.equal(new Set(o1.map(b=>b.blockId)).size,3)
  assert.deepEqual(o1.map(b=>b.variantCode).sort(),['Z','small-night','standard'])
  assert.ok(!result.some(b=>b.areaCode==='ZO1'||b.areaName.includes('ZO1')))
  assert.deepEqual(blocks,before)
})

test('canonical matching keeps Z and small-night variants, manual content and raw persistence identity',()=>{
  const o1=blocks.filter(b=>b.shiftType==='night'&&['O1','ZO1'].includes(b.areaCode)).map(b=>({...b,
    modifiedBy:'operator',modifiedAt:{seconds:123},drivers:[{employeeId:'MANUAL-'+b.blockId,employeeName:'人工'}],stations:[],assistants:[],workFocus:'保留工作重點'}))
  const before=structuredClone(o1)
  const r=assignSchedulesToDispatchBlocks({blocks:o1,schedules:[],employees:[],shift:'night'})
  assert.equal(r.blocks.length,3)
  r.blocks.forEach((b,i)=>{const {assignmentStatus,...raw}=b;assert.deepEqual(raw,before[i]);assert.equal(assignmentStatus,'manual')})
  const auto=o1.map(b=>({...b,modifiedBy:'',drivers:[]}))
  const employees=['standard','z','small'].map(employeeId=>({employeeId,name:employeeId,title:'PT-測試'}))
  const schedules=['O1','ZO1','小夜O1'].map((scheduleCode,i)=>({employeeId:employees[i].employeeId,employeeName:employees[i].name,shiftType:'night',scheduleCode}))
  const assigned=assignSchedulesToDispatchBlocks({blocks:auto,schedules,employees,shift:'night'})
  assert.deepEqual(assigned.unmatched,[])
  assert.equal(assigned.blocks.flatMap(b=>b.stations).length,3)
  for(const [variant,id]of [['standard','standard'],['Z','z'],['small-night','small']])assert.deepEqual(assigned.blocks.find(b=>b.variantCode===variant).stations.map(p=>p.employeeId),[id])
  assert.deepEqual(o1,before)
})
