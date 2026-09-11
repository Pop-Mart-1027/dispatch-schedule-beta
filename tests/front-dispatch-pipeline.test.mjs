import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

// Mock only the Firestore SDK boundary. Keep the production schedule reader,
// month eligibility, template query, preview builder, assignment and React view.
const date = '2026-09-14'
const employee = { employeeId: 'B0410', name: '陳均瑜', title: 'PT-晚夜', shiftSource: '早班+夜班' }
const record = { id: `B0410_${date}`, employeeId: 'B0410', employeeName: employee.name,
  date, shiftType: 'morning', scheduleCode: 'O1晚夜17-01', status: 'active', modifiedBy: 'system-import' }
const blocks = [
  ['day', 'single_253', 'standard'], ['day', 'single_254', 'standard'],
  ['day', 'single_255', 'standard'], ['night', 'right_107', 'small-night'],
  ['night', 'right_99', 'standard'],
].map(([shiftType, suffix, variantCode], index) => {
  const blockId = `2026-09-11_${shiftType}_${suffix}`
  return { id: blockId, blockId, date: '2026-09-11', shiftType, variantCode,
    areaCode: 'O1', areaName: variantCode === 'small-night' ? 'O1 小夜' : '藝文 O1區',
    vehicleNo: `vehicle-${index}`, vehicleType: '', drivers: [], stations: [], assistants: [],
    workFocus: '', balanceArea: '', note: '', sourceRow: index, sourceSheet: 'fixture',
    status: 'active', modifiedBy: shiftType === 'night' ? 'manual-import' : '' }
})
const fixture = { employees: [employee], scheduleRecords: [record], dispatchBlocks: blocks,
  layout: { monthKey: '2026-09', rows: [{ employeeId: 'B0410', group: 'night',
    section: 'O1區', areaCode: 'O1', blankDays: [] }] } }
const virtual = {
  'pipeline:firestore': `export * from 'firebase/firestore';
    export const collection = (_db,path)=>({path});
    export const doc = (_db,...parts)=>({path:parts.join('/')});
    export const where = (field,op,value)=>({kind:'where',field,op,value});
    export const orderBy = (field,direction)=>({kind:'order',field,direction});
    export const limit = value=>({kind:'limit',value});
    export const query = (ref,...constraints)=>({...ref,constraints});
    export async function getDoc(ref){
      window.reads.push(ref.path);
      if(ref.path==='dispatchConfiguration/base')return{exists:()=>false,data:()=>null};
      if(ref.path!=='scheduleMonthLayouts/2026-09')throw Error('Unexpected doc '+ref.path);
      return {exists:()=>true,data:()=>structuredClone(window.fixture.layout)};
    }
    export async function getDocs(ref){
      window.reads.push({path:ref.path,constraints:ref.constraints||[]});
      if(!Array.isArray(window.fixture[ref.path]))throw Error('Unexpected query '+ref.path);
      let rows=structuredClone(window.fixture[ref.path]);
      for(const c of ref.constraints||[]){
        if(c.kind==='where'){
          if(c.op!=='==')throw Error('Unexpected operator');
          rows=rows.filter(r=>r[c.field]===c.value);
        }
        if(c.kind==='order')rows.sort((a,b)=>String(a[c.field]).localeCompare(String(b[c.field]))*(c.direction==='desc'?-1:1));
        if(c.kind==='limit')rows=rows.slice(0,c.value);
      }
      return {docs:rows.map(r=>({id:r.id||r.employeeId,data:()=>r}))};
    }`,
  'pipeline:entry': `import React from 'react';import{createRoot}from'react-dom/client';
    import{FirestoreDispatchView}from'/app/page.tsx';
    import{listScheduleRecords}from'/lib/schedule-firestore.ts';
    import{listDispatchBlocks,listDispatchBlockTemplate,buildDispatchPreviewBlocks}from'/lib/dispatch-blocks-firestore.ts';
    import{parseScheduleAssignments,assignSchedulesToDispatchBlocks}from'/lib/dispatch-schedule-assignment.ts';
    import '/app/globals.css';
    window.tracePipeline=async()=>{
      window.assignmentStages=[];
      const schedules=await listScheduleRecords('${date}');
      const saved=await listDispatchBlocks('${date}');
      const template=await listDispatchBlockTemplate('${date}');
      const blocks=buildDispatchPreviewBlocks(template.blocks,'${date}');
      const parsed=schedules.flatMap(r=>parseScheduleAssignments(r.scheduleCode,blocks.map(b=>b.areaCode),r.shiftType==='morning'?'day':'night'));
      const results=['day','night'].map(shift=>assignSchedulesToDispatchBlocks({blocks,schedules,employees:window.fixture.employees,shift}));
      const assignments=results.flatMap(r=>r.blocks).flatMap(b=>[...b.drivers,...b.stations,...b.assistants].map(p=>({employeeId:p.employeeId,shift:b.shiftType,variant:b.variantCode,blockId:b.blockId})));
      return {schedules,saved:saved.length,sourceDate:template.sourceDate,parsed,assignments,stages:window.assignmentStages,unmatched:results.flatMap(r=>r.unmatched)};
    };
    createRoot(document.getElementById('root')).render(React.createElement(FirestoreDispatchView,{employeeId:'B0410',isDuty:false}));`,
}
const server = await createServer({ configFile: false, logLevel: 'error',
  resolve: { alias: { '@': process.cwd() } }, esbuild: { jsx: 'automatic' },
  plugins: [{ name: 'production-dispatch-pipeline', enforce: 'pre',
    resolveId(id) { if (id in virtual) return '\0' + id },
    load(id) { if (id.startsWith('\0pipeline:')) return virtual[id.slice(1)] },
    transform(code, id) {
      const path = id.replaceAll('\\', '/')
      if (!['/app/page.tsx', '/lib/schedule-firestore.ts', '/lib/dispatch-blocks-firestore.ts',
        '/lib/month-schedule-layout.ts', '/lib/dispatch-schedule-assignment.ts', '/lib/dispatch-configuration.ts'].some(suffix => path.endsWith(suffix))) return
      code = code.replaceAll("from 'firebase/firestore'", "from 'pipeline:firestore'")
      if (path.endsWith('/lib/dispatch-schedule-assignment.ts')) {
        // Observe the production grouping/dedupe in situ, without substituting it.
        code = code.replace('grouped.forEach((rows, key) => {', `
          window.assignmentStages ||= [];
          window.assignmentStages.push({shift,groups:[...grouped].map(([key,rows])=>({key,ids:rows.map(r=>r.employee.employeeId)}))});
          grouped.forEach((rows, key) => {`)
      }
      if (path.endsWith('/app/page.tsx')) {
        // Capture the actual render input, not a separately implemented grouper.
        code = code.replace('const jumpAreas=useMemo', 'window.__renderBlocks = visible; const jumpAreas=useMemo')
        code += '\nexport { FirestoreDispatchView };'
      }
      return code
    },
    configureServer(server) { server.middlewares.use('/pipeline-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/pipeline-test', '<div id="root"></div><script type="module" src="/@id/__x00__pipeline:entry"></script>'))
    }) },
  }, react()], server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
after(async () => { await browser.close(); await server.close() })

async function openFixture(code, duplicate = false) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', msg => { if (/same key/i.test(msg.text())) errors.push(msg.text()) })
  await page.addInitScript(({fixture,code,duplicate}) => {
    window.fixture = fixture; window.reads = []
    fixture.scheduleRecords[0].scheduleCode = code
    if(duplicate)fixture.scheduleRecords.push({...fixture.scheduleRecords[0],id:'duplicate-fixture-row'})
    const NativeDate = Date
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-09-14T12:00:00+08:00'])) } }
  }, {fixture,code,duplicate})
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pipeline-test`)
  await page.waitForFunction(() => window.tracePipeline && window.reads.some(r=>r?.constraints?.some(c=>c.kind==='limit')))
  return {page,errors}
}

test('9/14 compound cell passes real readers, template selection, assignment, dedupe and React cards', async () => {
  const {page,errors} = await openFixture('O1晚夜17-01', true)
  try {
    const trace = await page.evaluate(() => window.tracePipeline())
    assert.equal(trace.saved, 0)
    assert.equal(trace.sourceDate, '2026-09-11')
    assert.deepEqual(trace.parsed.map(p=>p.shift), ['day','night','day','night'])
    assert.deepEqual(trace.stages, ['day','night'].map(shift=>({shift,groups:[{key:'O1|standard',ids:['B0410']}]})))
    assert.equal(trace.assignments.length, 2)
    assert.deepEqual(trace.assignments.map(p=>[p.employeeId,p.shift,p.variant]), [['B0410','day','standard'],['B0410','night','standard']])
    assert.equal(new Set(trace.assignments.map(p=>`${p.employeeId}|${p.shift}|${p.variant}|${p.blockId}`)).size, 2)
    assert.deepEqual(trace.unmatched, [])
    for (const [label,shift] of [['夜班','night'],['早班','day'],['夜班','night']]) {
      await page.getByRole('button',{name:label,exact:true}).click()
      await page.waitForFunction(shift => window.__renderBlocks?.some(b=>b.shiftType===shift && b.stations.some(p=>p.employeeId==='B0410')), shift)
      assert.equal(await page.locator('.dispatch-card .person').filter({hasText:'陳均瑜'}).count(),1)
      assert.equal(await page.evaluate(() => window.__renderBlocks.flatMap(b=>b.stations).filter(p=>p.employeeId==='B0410').length),1)
    }
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('actual empty 9/14 schedule does not inherit people from template or invent assignments', async () => {
  const {page,errors} = await openFixture('')
  try {
    const trace = await page.evaluate(() => window.tracePipeline())
    assert.deepEqual(trace.parsed, [])
    assert.deepEqual(trace.assignments, [])
    for(const label of ['夜班','早班']) {
      await page.getByRole('button',{name:label,exact:true}).click()
      await page.locator('.loading').filter({hasText:'此日期尚無'}).waitFor()
      assert.equal(await page.locator('.dispatch-card .person').count(),0)
    }
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
