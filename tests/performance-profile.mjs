import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { scheduleSections } from '../functions/pre-schedule-order.mjs'
import { getAreaJumpOptions } from '../functions/schedule-display.mjs'

const source = JSON.parse(readFileSync('public/september-schedules.json', 'utf8'))
const employees = JSON.parse(readFileSync('output/employee-master.json', 'utf8'))
const template = JSON.parse(readFileSync('output/dispatch-blocks-20260909-simulation.json', 'utf8')).blocks.map(block => ({ ...block, id: block.blockId }))
const byEmployee = new Map()
for (const shift of ['morning', 'night']) for (const row of source[shift]) {
  byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) || []), { row, shift }])
}
const schedules = Object.fromEntries([9, 13].map(day => [`2026-09-${String(day).padStart(2, '0')}`, employees.map(employee => {
  const rows = byEmployee.get(employee.employeeId)
  return {
    employeeId: employee.employeeId, employeeName: employee.name, title: employee.title,
    date: `2026-09-${String(day).padStart(2, '0')}`, shiftType: rows[0].shift,
    scheduleCode: [...new Set(rows.map(({ row }) => row.shifts[day - 1]).filter(Boolean))].join('／'),
  }
})]))
const fixture = { employees, template, schedules, source }
fixture.monthSchedules = Array.from({ length: 30 }, (_, index) => employees.map(employee => {
  const rows = byEmployee.get(employee.employeeId)
  return { employeeId: employee.employeeId, employeeName: employee.name, title: employee.title,
    date: `2026-09-${String(index + 1).padStart(2, '0')}`, shiftType: rows[0].shift,
    scheduleCode: [...new Set(rows.map(({ row }) => row.shifts[index]).filter(Boolean))].join('／') }
})).flat().map(record=>({...record,id:record.employeeId+'_'+record.date}))
const virtual = {
  'test:month-layout': `import {initialMonthRows,changeMonthRows,monthSectionCatalog,changeMonthSections} from '/functions/month-schedule-layout.mjs';
    import {moveWorkArea} from '/functions/month-schedule-policy.mjs';
    export async function getMonthLayout(month){window.recordRead('scheduleMonthLayouts',1);return window.monthLayouts?.[month] || null;}
    export async function manageMonthRow(input){ window.recordWrite('callable:'+input.action,null);
      window.monthLayouts ||= {};window.rowCalls ||= [];window.rowCalls.push(input);
      const old=window.monthLayouts[input.monthKey];
      const ids=new Set(window.fixture.monthSchedules.map(r=>r.employeeId));
      const rows=old?.rows || initialMonthRows(window.fixture.employees.filter(p=>ids.has(p.employeeId)));
      const sections=monthSectionCatalog(rows,old);
      if(input.action.startsWith('section-')){
        const result=changeMonthSections(sections,rows,input,'custom:'+window.rowCalls.length);
        window.monthLayouts[input.monthKey]={...old,monthKey:input.monthKey,rows,sections:result.sections,revision:(old?.revision||0)+1};return;
      }
      const result=changeMonthRows(rows,input,window.fixture.employees.find(p=>p.employeeId===input.employeeId),input.monthKey);
      const excluded=new Set(old?.excludedEmployeeIds||[]);
      if(input.action==='remove')excluded.add(input.employeeId);
      if(input.action==='add')excluded.delete(input.employeeId);
      if(input.action==='move'&&result.before.areaCode&&result.after.areaCode)for(const record of [...window.fixture.monthSchedules,...Object.values(window.fixture.schedules).flat()])if(record.employeeId===input.employeeId&&record.date.startsWith(input.monthKey))record.scheduleCode=moveWorkArea(record.scheduleCode,result.before.areaCode,result.after.areaCode);
      window.monthLayouts[input.monthKey]={monthKey:input.monthKey,revision:(old?.revision || 0)+1,rows:result.rows,sections,excludedEmployeeIds:[...excluded]};
    }`,
  'test:firestore': `export * from 'firebase/firestore';
    export function onSnapshot(ref,next) {
      if(ref.path === 'systemSettings/features') {
        window.featureListeners ||= new Set(); window.featureListeners.add(next);
        queueMicrotask(()=>next({exists:()=>!!window.features,data:()=>window.features}));
        return ()=>window.featureListeners.delete(next);
      }
      queueMicrotask(()=>next({exists:()=>true,data:()=>({active:true})}));return ()=>{};
    }
    export async function runTransaction(_db,handler) {
      if(window.manualPickerTest){
        const writes=[];window.recordRead('transaction:base+block',2);await handler({get:async ref=>{const value=ref.path==='dispatchConfiguration/base'?window.configBase:window.formalByDate?.['2026-09-09']?.find(b=>b.id===ref.id);return {exists:()=>!!value,data:()=>value}},set:(ref,data)=>writes.push([ref,data])});
        window.recordWrite('dispatch transaction',writes.length);for(const [ref,data]of writes){if(ref.path==='dispatchConfiguration/base')window.configBase=data;else if(ref.path.startsWith('dispatchConfigurationVersions/'))(window.configVersions ||= []).push({id:ref.id,...data});else if(ref.path.startsWith('dispatchAuditLogs/'))window.manualAudits.push(data);else if(ref.path.startsWith('dispatchBlocks/')){const rows=window.formalByDate['2026-09-09'];const b=rows.find(b=>b.id===ref.id);if(b)Object.assign(b,data);else rows.push({id:ref.id,...data});}else throw Error('Unexpected write');}return;
      }
      if(window.failSettings)throw Error('test denied');
      let value;
      await handler({get:async()=>({exists:()=>!!window.features,data:()=>window.features}),
        update:(_ref,data)=>{value={...window.features,...data}},set:(_ref,data)=>{value=data}});
      window.features=value; window.settingsWrites=(window.settingsWrites||0)+1;
      window.featureListeners?.forEach(next=>next({exists:()=>true,data:()=>window.features}));
    }
    export async function getDoc() {return {exists:()=>!!window.scheduleSetting,data:()=>window.scheduleSetting};}
    export async function addDoc(ref,data) { if(ref.path!=='dispatchAuditLogs'||!window.manualPickerTest)throw Error('Unexpected audit write');window.manualAudits.push(data);return {id:'audit'}; }
    export async function setDoc(_ref,data) {if(_ref.path.startsWith('dispatchBlocks/')){if(!window.manualPickerTest)throw Error('Unexpected dispatch write');const rows=window.formalByDate['2026-09-09'];const block=rows.find(b=>b.id===_ref.id);Object.assign(block,data);return;}window.scheduleSetting={...data,updatedAt:{toDate:()=>new Date()}};}
    export async function getDocs() { window.recordRead('employees',window.fixture.employees.length);return { docs: window.fixture.employees.map(employee => ({ id: employee.employeeId, data: () => employee })) } }`,
  'test:auth': `export * from 'firebase/auth'; export function onAuthStateChanged(_auth,callback) {queueMicrotask(()=>callback({uid:'96504'}));return ()=>{};}`,
  'test:broadcasts': `export * from '/lib/broadcasts.ts';
    export async function listActiveBroadcasts(){window.broadcastLoads=(window.broadcastLoads||0)+1;return window.testBroadcasts||[];}
    export async function getBroadcastRead(){return null;} export async function recordBroadcastShown(){}`,
  'test:blocks': `export * from '/lib/dispatch-blocks-firestore.ts';
    import {eligibleMonthBlocks} from '/functions/month-schedule-policy.mjs';
    import {updateDispatchBlock as realUpdate,writeDispatchBlockAudit as realAudit} from '/lib/dispatch-blocks-firestore.ts';
    const denyWrite = () => { window.writeAttempts++; throw new Error('Front preview must remain read-only') };
    export const updateDispatchBlock = (...args)=>window.manualPickerTest?realUpdate(...args):denyWrite(), writeDispatchBlockAudit = (...args)=>window.manualPickerTest?realAudit(...args):denyWrite(), saveDispatchPreviewAsFormal = denyWrite;
    export async function getDispatchBlock(id,date){window.recordRead('dispatchBlock:one',1);window.recordRead('scheduleMonthLayouts',1);return eligibleMonthBlocks(window.formalByDate?.[date]||[],window.monthLayouts?.[date.slice(0,7)]).find(b=>b.id===id)}
    export async function listDispatchBlocks(date) { window.recordRead('dispatchBlocks:'+date,(window.formalByDate?.[date]||(date==='2026-09-09'?window.fixture.template:[])).length);window.recordRead('scheduleMonthLayouts',1);window.recordRead('dispatchConfiguration/base',1);
      await new Promise(resolve => setTimeout(resolve, window.delays?.[date] || 0));
      return eligibleMonthBlocks(window.formalByDate?.[date] || (date === '2026-09-09' ? window.fixture.template : []),window.monthLayouts?.[date.slice(0,7)]);
    }
    export async function listDispatchBlockTemplate() { window.templateReads++; return { sourceDate: '2026-09-09', blocks: window.fixture.template } }`,
  'test:schedules': `export * from '/lib/schedule-firestore.ts';
    import {eligibleMonthSchedules} from '/functions/month-schedule-policy.mjs';
    export async function getScheduleRecord(id){window.recordRead('scheduleRecord:one',1);return {...window.fixture.monthSchedules.find(r=>(r.id || r.employeeId+'_'+r.date)===id)}}
    export async function updateFormalScheduleCell(record,code,modifiedBy) {
      window.recordRead('transaction:cell+layout',2);window.recordWrite('scheduleRecord+audit',2);window.scheduleEdits ||= [];
      window.scheduleEdits.push({recordId:record.id,employeeId:record.employeeId,date:record.date,before:record.scheduleCode,after:code,modifiedBy});
      const target=window.fixture.monthSchedules.find(item=>item.employeeId===record.employeeId&&item.date===record.date);
      target.scheduleCode=code;
    }
    export async function listMonthScheduleRecords(month='2026-09',employeeId) { window.recordRead('scheduleRecords:month',window.fixture.monthSchedules.filter(r=>r.date.startsWith(month)&&(!employeeId||r.employeeId===employeeId)).length);window.recordRead('scheduleMonthLayouts',1);return eligibleMonthSchedules(window.fixture.monthSchedules.filter(r=>r.date.startsWith(month)),window.monthLayouts?.[month]); }
    export async function listScheduleRecords(date) { window.recordRead('scheduleRecords:'+date,(window.fixture.schedules[date]||[]).length);window.recordRead('scheduleMonthLayouts',1);
      await new Promise(resolve => setTimeout(resolve, window.delays?.[date] || 0));
      return eligibleMonthSchedules(window.fixture.schedules[date] || [],window.monthLayouts?.[date.slice(0,7)]);
    }`,
  'test:functions': `export * from 'firebase/functions';
    export const httpsCallable = (_service, name) => async data => {
      if (name === 'getMyProfile') return {data:{employeeId:'96504',name:'涂佑葦',role:'employee',active:true,mustChangePassword:false}};
      if (name !== 'syncDispatchBlocks') throw new Error('Unexpected callable');
      window.importCalls.push(data);
      window.formalByDate = { ...window.formalByDate, [data.date]: window.fixture.template.map(block => ({...block, date: data.date, modifiedBy: 'manual-import'})) };
      return {data: {date: data.date, dayBlocks: 89, nightBlocks: 94, conflicts: 0}};
    };`,
  'test:entry': `import React from 'react'; import { createRoot } from 'react-dom/client';
    import Home, { FirestoreDispatchView, ScheduleMatrix, ScheduleView, scheduleRecordsToData, DutyStaffPanel, HomeView } from '/app/page.tsx';
    import { ScheduleManager, DutyColumn, DispatchManager, Dashboard, PreScheduleSettings } from '/app/admin-console.tsx';
    import {SystemFeatureSettings} from '/app/system-feature-settings.tsx';
    import {WorkFocus} from '/app/work-focus.tsx';
    import '/app/globals.css';
    const root = createRoot(document.getElementById('root'));
    window.showFocus = (text,collapsible)=>root.render(React.createElement('div',{style:{width:300}},React.createElement(WorkFocus,{key:String(collapsible),text,collapsible})));
    window.showFullApp = ()=>root.render(React.createElement(Home));
    window.showSettings = ()=>root.render(React.createElement('div',{className:'admin-console'},React.createElement('aside',{className:'admin-sidebar'},'調度工作台'),React.createElement('main',{className:'admin-main'},React.createElement(SystemFeatureSettings,{employeeId:'A001'}))));
    window.showPreSettings = ()=>root.render(React.createElement('div',{className:'admin-console'},React.createElement(PreScheduleSettings,{employeeId:'A001'})));
    function ScheduleShell({children}) {
      return React.createElement('div', {className:'app-shell', 'data-page':'schedule'},
        React.createElement('aside', {className:'sidebar'}),
        React.createElement('main', {className:'workspace'},
          React.createElement('header', {className:'topbar'}, '班表'),
          React.createElement('section', {className:'content'}, children)));
    }
    window.showDispatch = (employeeId = 'test', isDuty = false) => root.render(React.createElement('div', {className: 'app-shell','data-page':'dispatch'},React.createElement('main',{className:'workspace'},React.createElement('section',{className:'content'}, React.createElement(FirestoreDispatchView, {employeeId, isDuty, key: employeeId + ':' + isDuty})))));
    window.showHome = () => root.render(React.createElement('div', {className: 'app-shell'}, React.createElement(HomeView, {name: '登入人員', onAction: () => {}, onGo: () => {}})));
    window.showFrontDuty = (shift, staff) => root.render(React.createElement(DutyStaffPanel, {shift, staff}));
    window.showManager = () => root.render(React.createElement('div', {className: 'admin-console'}, React.createElement(DispatchManager, {employeeId: 'test',admin:true})));
    window.showDashboard = () => root.render(React.createElement('div', {className: 'admin-console'}, React.createElement(Dashboard, {role: 'admin', onOpenDispatch: () => {}})));
    window.showSchedule = shift => {
      const data = scheduleRecordsToData(window.fixture.monthSchedules, window.fixture.employees);
      root.render(React.createElement(ScheduleShell, null, React.createElement(ScheduleMatrix, {key: shift, rows: data[shift], days: data.days, group: shift === 'morning' ? 'day' : 'night'})));
    };
    function ScheduleTest() {
      const [tab, setTab] = React.useState('morning');
      const data = React.useMemo(() => scheduleRecordsToData(window.fixture.monthSchedules, window.fixture.employees), []);
      return React.createElement(ScheduleView, {tab, setTab, data, employeeId: '96504'});
    }
    window.showScheduleView = () => root.render(React.createElement(ScheduleShell, null, React.createElement(ScheduleTest)));
    window.showAdminSchedule = (admin = false) => root.render(React.createElement('div', {className: 'admin-console'},
      React.createElement('aside', {className: 'admin-sidebar'}), React.createElement('main', {className: 'admin-main'},
        React.createElement('header', {className: 'admin-topbar'}), React.createElement('section', {className: 'admin-content'}, React.createElement(ScheduleManager, {employeeId: 'test', admin})))));
    window.showMonitors = (taipei, newTaipei) => root.render(React.createElement('div', null,
      React.createElement(DutyColumn, {title: '夜班', duty: {directors: [], deputyDirectors: [], taipei, newTaipei}}),
      React.createElement(DutyStaffPanel, {shift: 'night', staff: {directors: [], deputyDirectors: [], taipeiMonitors: taipei, newTaipeiMonitors: newTaipei}})));
    window.showDispatch();`,
}
virtual['test:month-group'] = "export * from '/functions/month-schedule-layout.mjs';import {monthSections as run} from '/functions/month-schedule-layout.mjs';export function monthSections(...args){const t=performance.now();const result=run(...args);window.perf?.groupSort.push(performance.now()-t);return result}";
virtual['test:assignment'] = "export * from '/lib/dispatch-schedule-assignment.ts';import {assignSchedulesToDispatchBlocks as run} from '/lib/dispatch-schedule-assignment.ts';export function assignSchedulesToDispatchBlocks(input){const start=performance.now();const result=run(input);window.perf?.assignment.push(performance.now()-start);return result}";
virtual['test:area'] = "export * from '/lib/dispatch-area.ts';import {dispatchAreaDisplay as display,dispatchBlockFrontOrder as order} from '/lib/dispatch-area.ts';export function dispatchAreaDisplay(...args){const start=performance.now();const r=display(...args);window.perf?.groupSort.push(performance.now()-start);return r} export function dispatchBlockFrontOrder(...args){const start=performance.now();const r=order(...args);window.perf?.groupSort.push(performance.now()-start);return r}";
virtual['test:entry']=virtual['test:entry'].replace("const root = createRoot(document.getElementById('root'));", "const actualRoot=createRoot(document.getElementById('root'));const root={render:element=>actualRoot.render(React.createElement(React.Profiler,{id:'screen',onRender:(id,phase,actualDuration,baseDuration)=>window.perf?.renders.push({phase,actualDuration,baseDuration})},element))};");
const baselineFiles = new Set(['app/admin-console.tsx','app/month-row-manager.tsx','app/page.tsx','lib/dispatch-blocks-firestore.ts','lib/schedule-firestore.ts','lib/month-schedule-layout.ts']);
const baselineSource = process.env.PROFILE_BASELINE ? new Map([...baselineFiles].map(path=>[path,execFileSync('git',['show','0abf71e150ee50541debdad55784b7ed0f9e5fb2:'+path],{encoding:'utf8'})])) : new Map();
const server = await createServer({
  resolve: {alias:{'@':process.cwd()}},
  configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'front-readonly-fixture', enforce: 'pre',
    resolveId(id) { if (id in virtual) return '\0' + id + '.tsx' },
    load(id) { if (id.startsWith('\0test:')) return virtual[id.slice(1, -4)] },
    transform(code, id) {
      const relative=id.replaceAll('\\','/').replace(process.cwd().replaceAll('\\','/')+'/', '');
      if (baselineSource.has(relative)) code=baselineSource.get(relative);
      if(['/app/month-row-manager.tsx','/app/month-section-manager.tsx'].some(path=>id.replaceAll('\\', '/').endsWith(path))) return code.replace("from '../lib/month-schedule-layout'", "from 'test:month-layout'");
      if(['/lib/system-features.ts','/lib/dispatch-blocks-firestore.ts','/lib/dispatch-configuration.ts'].some(path=>id.replaceAll('\\', '/').endsWith(path))) return code.replace("from 'firebase/firestore'", "from 'test:firestore'");
      const admin = id.replaceAll('\\', '/').endsWith('/app/admin-console.tsx')
      if (!admin && !id.replaceAll('\\', '/').endsWith('/app/page.tsx')) return
      return code.replace("from 'firebase/firestore'", "from 'test:firestore'")
        .replace("from '../lib/dispatch-schedule-assignment'", "from 'test:assignment'")
        .replace("from '../lib/dispatch-area'", "from 'test:area'")
        .replace("from '../functions/month-schedule-layout.mjs'", "from 'test:month-group'")
        .replace("from 'firebase/auth'", "from 'test:auth'")
        .replace("from '../lib/broadcasts'", "from 'test:broadcasts'")
        .replace("from 'firebase/functions'", "from 'test:functions'")
        .replace("from '../lib/dispatch-blocks-firestore'", "from 'test:blocks'")
        .replaceAll("from '../lib/schedule-firestore'", "from 'test:schedules'")
        .replaceAll("from '../lib/month-schedule-layout'", "from 'test:month-layout'")
        + (admin ? '\nexport { ScheduleManager, DutyColumn, DispatchManager, Dashboard, PreScheduleSettings };' : '\nexport { FirestoreDispatchView, ScheduleMatrix, ScheduleView, scheduleRecordsToData, DutyStaffPanel, HomeView };')
    },
    configureServer(server) {
      server.middlewares.use('/preview-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/preview-test', '<div id="root"></div><script type="module" src="/@id/__x00__test:entry.tsx"></script>'))
      })
    },
  }, react({ fastRefresh: false })],
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
after(async () => { await browser.close(); await server.close() })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(15000);
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(data => {
  window.perf={reads:[],writes:[],assignment:[],groupSort:[],renders:[]};window.recordRead=(name,docs)=>window.perf.reads.push({name,docs});window.recordWrite=(name,docs)=>window.perf.writes.push({name,docs});window.fixture = data; window.templateReads = 0; window.writeAttempts = 0; window.importCalls = []
  // Initial date is pinned without changing timers or component source.
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:00:00+08:00'])) }
  }
}, fixture)
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/preview-test`)


const results=[];
const cpu = process.env.PROFILE_CPU ? await page.context().newCDPSession(page) : null;
if(cpu) await cpu.send('Profiler.enable');
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function measure(name,action){await settle();await page.evaluate(()=>window.perf={reads:[],writes:[],assignment:[],groupSort:[],renders:[]});if(cpu && name==='month shift switch') await cpu.send('Profiler.start');const start=performance.now();await action();await settle();if(cpu && name==='month shift switch'){const {profile}=await cpu.send('Profiler.stop');writeFileSync('output/performance-month-cpu.json',JSON.stringify(profile));}const p=await page.evaluate(()=>window.perf);const sum=a=>a.reduce((a,b)=>a+b,0);results.push({name,totalMs:performance.now()-start,readCalls:p.reads.length,returnedDocs:p.reads.reduce((a,b)=>a+b.docs,0),reads:p.reads,writes:p.writes,assignmentCalls:p.assignment.length,assignmentMs:sum(p.assignment),groupSortMs:sum(p.groupSort),renderCount:p.renders.length,renderMs:sum(p.renders.map(r=>r.actualDuration)),maxRenderMs:Math.max(0,...p.renders.map(r=>r.actualDuration))});}
await page.evaluate(()=>{window.fixture.monthSchedules.forEach(r=>r.id=r.employeeId+'_'+r.date);window.manualPickerTest=true;window.manualAudits=[];window.formalByDate={'2026-09-09':structuredClone(window.fixture.template)};window.fixture.employees.forEach(p=>p.active=true)});
await measure('dispatch admin load',async()=>{await page.evaluate(()=>window.showManager());await page.locator('.dispatch-table tbody tr').first().waitFor()});
await measure('open dispatch editor',async()=>{await page.locator('.dispatch-table tbody tr').first().getByRole('button',{name:'修改',exact:true}).click();await page.getByLabel('區域名稱',{exact:true}).waitFor()});
await measure('edit dispatch field',()=>page.getByLabel('車號',{exact:true}).fill('PROFILE-CAR'));
await measure('save day',async()=>{await page.getByRole('button',{name:'儲存本日',exact:true}).click();await page.locator('.admin-edit-grid').waitFor({state:'hidden'});await page.getByText('PROFILE-CAR',{exact:true}).first().waitFor()});
await page.locator('.dispatch-table tbody tr').filter({hasText:'PROFILE-CAR'}).getByRole('button',{name:'修改',exact:true}).click();await page.getByLabel('車號',{exact:true}).fill('PROFILE-VERSION');
await measure('save version',async()=>{await page.getByRole('button',{name:'套用為新版配置',exact:true}).click();await page.locator('.admin-edit-grid').waitFor({state:'hidden'});await page.getByText('PROFILE-VERSION',{exact:true}).first().waitFor()});
await measure('dispatch date switch',async()=>{await page.locator('input[type=date]').fill('2026-09-13');await page.locator('.admin-preview-note').waitFor()});
await measure('dispatch shift switch',()=>page.locator('select').first().selectOption('night'));
await measure('front dispatch load',async()=>{await page.evaluate(()=>window.showDispatch());await page.locator('.dispatch-card').first().waitFor()});
await measure('formal month load',async()=>{await page.evaluate(()=>window.showAdminSchedule(true));await page.locator('.admin-schedule tr[data-employee-id]').first().waitFor()});
await measure('month shift switch',()=>page.locator('.schedule-group-switch button').nth(1).click());
const cell=page.locator('.admin-schedule tr[data-employee-id="96504"] td[data-date-column] button').nth(8);
await measure('open cell editor',async()=>{await cell.click();await page.getByRole('dialog').waitFor()});
await page.getByRole('button',{name:'慰',exact:true}).click();await page.getByRole('button',{name:'儲存修改',exact:true}).click();
await measure('save cell',async()=>{await page.getByRole('button',{name:'確認儲存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})});
const ids=scheduleSections(employees,'night').find(s=>s.areaCode==='O1').people.map(p=>p.employeeId);const first=page.locator('tr[data-employee-id="'+ids[0]+'"]'),target=page.locator('tr[data-employee-id="'+ids[2]+'"]');
await measure('row reorder',async()=>{const dt=await page.evaluateHandle(()=>new DataTransfer());await first.locator('.schedule-drag-handle').dispatchEvent('dragstart',{dataTransfer:dt});await target.dispatchEvent('drop',{dataTransfer:dt,clientY:1});await dt.dispose();await page.getByText('順序已儲存',{exact:true}).waitFor()});
await page.getByRole('button',{name:'管理 96504 涂佑葦',exact:true}).click();await page.getByRole('button',{name:'換區',exact:true}).click();await page.getByLabel('區域',{exact:true}).selectOption('area:K1');
await measure('move area',async()=>{await page.getByRole('button',{name:'儲存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})});
console.log(JSON.stringify(results,null,2));writeFileSync(process.env.PROFILE_OUTPUT||'output/performance-baseline.json',JSON.stringify({mode:'isolated real React development build; fixture Firestore boundary, no network latency; read counts modeled from service call graph; callable backend reads/writes not measured',employees:employees.length,monthRecords:fixture.monthSchedules.length,blocks:template.length,results},null,2));

test('profile scenarios completed and targeted refresh avoids full queries',()=>{
  assert.equal(results.length,14);
  if(!process.env.PROFILE_BASELINE){
    for(const name of ['save day','save version','save cell','row reorder'])assert.ok(results.find(r=>r.name===name).reads.every(r=>!r.name.startsWith('dispatchBlocks:')&&!r.name.startsWith('scheduleRecords:')&&r.name!=='employees'),name);
    assert.equal(results.find(r=>r.name==='move area').reads.find(r=>r.name==='scheduleRecords:month').docs,30);
  }
});
