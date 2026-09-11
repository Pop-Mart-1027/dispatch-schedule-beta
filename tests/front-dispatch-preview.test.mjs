import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
})).flat()
const virtual = {
  'test:month-layout': `import {initialMonthRows,changeMonthRows,monthSectionCatalog,changeMonthSections} from '/functions/month-schedule-layout.mjs';
    import {moveWorkArea} from '/functions/month-schedule-policy.mjs';
    export async function getMonthLayout(month){return window.monthLayouts?.[month] || null;}
    export async function manageMonthRow(input){
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
        const writes=[];await handler({get:async ref=>{const value=ref.path==='dispatchConfiguration/base'?window.configBase:window.formalByDate?.['2026-09-09']?.find(b=>b.id===ref.id);return {exists:()=>!!value,data:()=>value}},set:(ref,data)=>writes.push([ref,data])});
        for(const [ref,data]of writes){if(ref.path==='dispatchConfiguration/base')window.configBase=data;else if(ref.path.startsWith('dispatchConfigurationVersions/'))(window.configVersions ||= []).push({id:ref.id,...data});else if(ref.path.startsWith('dispatchAuditLogs/'))window.manualAudits.push(data);else if(ref.path.startsWith('dispatchBlocks/')){const rows=window.formalByDate['2026-09-09'];const b=rows.find(b=>b.id===ref.id);if(b)Object.assign(b,data);else rows.push({id:ref.id,...data});}else throw Error('Unexpected write');}return;
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
    export async function getDocs() { return { docs: window.fixture.employees.map(employee => ({ id: employee.employeeId, data: () => employee })) } }`,
  'test:auth': `export * from 'firebase/auth'; export function onAuthStateChanged(_auth,callback) {queueMicrotask(()=>callback({uid:'96504'}));return ()=>{};}`,
  'test:broadcasts': `export * from '/lib/broadcasts.ts';
    export async function listActiveBroadcasts(){window.broadcastLoads=(window.broadcastLoads||0)+1;return window.testBroadcasts||[];}
    export async function getBroadcastRead(){return null;} export async function recordBroadcastShown(){}`,
  'test:blocks': `export * from '/lib/dispatch-blocks-firestore.ts';
    import {eligibleMonthBlocks} from '/functions/month-schedule-policy.mjs';
    import {updateDispatchBlock as realUpdate,writeDispatchBlockAudit as realAudit} from '/lib/dispatch-blocks-firestore.ts';
    const denyWrite = () => { window.writeAttempts++; throw new Error('Front preview must remain read-only') };
    export const updateDispatchBlock = (...args)=>window.manualPickerTest?realUpdate(...args):denyWrite(), writeDispatchBlockAudit = (...args)=>window.manualPickerTest?realAudit(...args):denyWrite(), saveDispatchPreviewAsFormal = denyWrite;
    export async function listDispatchBlocks(date) {
      await new Promise(resolve => setTimeout(resolve, window.delays?.[date] || 0));
      return eligibleMonthBlocks(window.formalByDate?.[date] || (date === '2026-09-09' ? window.fixture.template : []),window.monthLayouts?.[date.slice(0,7)]);
    }
    export async function listDispatchBlockTemplate() { window.templateReads++; return { sourceDate: '2026-09-09', blocks: window.fixture.template } }`,
  'test:schedules': `export * from '/lib/schedule-firestore.ts';
    import {eligibleMonthSchedules} from '/functions/month-schedule-policy.mjs';
    export async function updateFormalScheduleCell(record,code,modifiedBy) {
      window.scheduleEdits ||= [];
      window.scheduleEdits.push({recordId:record.id,employeeId:record.employeeId,date:record.date,before:record.scheduleCode,after:code,modifiedBy});
      const target=window.fixture.monthSchedules.find(item=>item.employeeId===record.employeeId&&item.date===record.date);
      target.scheduleCode=code;
    }
    export async function listMonthScheduleRecords(month='2026-09') { return eligibleMonthSchedules(window.fixture.monthSchedules.filter(r=>r.date.startsWith(month)),window.monthLayouts?.[month]); }
    export async function listScheduleRecords(date) {
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
const server = await createServer({
  resolve: {alias:{'@':process.cwd()}},
  configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'front-readonly-fixture', enforce: 'pre',
    resolveId(id) { if (id in virtual) return '\0' + id + '.tsx' },
    load(id) { if (id.startsWith('\0test:')) return virtual[id.slice(1, -4)] },
    transform(code, id) {
      if(['/app/month-row-manager.tsx','/app/month-section-manager.tsx'].some(path=>id.replaceAll('\\', '/').endsWith(path))) return code.replace("from '../lib/month-schedule-layout'", "from 'test:month-layout'");
      if(['/lib/system-features.ts','/lib/dispatch-blocks-firestore.ts','/lib/dispatch-configuration.ts'].some(path=>id.replaceAll('\\', '/').endsWith(path))) return code.replace("from 'firebase/firestore'", "from 'test:firestore'");
      const admin = id.replaceAll('\\', '/').endsWith('/app/admin-console.tsx')
      if (!admin && !id.replaceAll('\\', '/').endsWith('/app/page.tsx')) return
      return code.replace("from 'firebase/firestore'", "from 'test:firestore'")
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
  window.fixture = data; window.templateReads = 0; window.writeAttempts = 0; window.importCalls = []
  // Initial date is pinned without changing timers or component source.
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:00:00+08:00'])) }
  }
}, fixture)
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/preview-test`)

test('dispatch Z areas share canonical front cards, admin filters and first-area jump without merging blocks', async () => {
  await page.reload();
  await page.evaluate(() => {
    window.formalByDate={'2026-09-09':window.fixture.template.map(b=>({...b,modifiedBy:'operator',
      drivers:b.drivers.length?b.drivers:[{employeeId:'test-driver',employeeName:'測試駕駛'}]}))};
    window.showManager();
  });
  await page.locator('select').first().selectOption('night');
  await page.waitForFunction(()=>document.querySelectorAll('.dispatch-table tbody tr').length===94);
  assert.equal(await page.locator('.dispatch-table tbody tr').filter({hasText:'藝文 O1'}).count(),2);
  assert.doesNotMatch(await page.locator('.dispatch-table').textContent(),/Z(?:O1|R3?|K[34]|L[1-4]|U|W1|H)區/);
  const area=page.getByLabel('區域篩選');
  assert.doesNotMatch(await area.textContent(),/ZO1|ZR|ZK|ZL|ZU|ZW|ZH/);
  await area.selectOption('O1');
  assert.equal(await page.locator('.dispatch-table tbody tr').count(),3);
  await page.evaluate(()=>window.showDispatch());
  await page.waitForFunction(()=>document.querySelectorAll('.dispatch-card').length===94);
  const cards=page.locator('.dispatch-card[data-area-code="O1"]');
  assert.equal(await cards.count(),3);
  assert.doesNotMatch(await page.locator('.dispatch-grid').textContent(),/Z(?:O1|R3?|K[34]|L[1-4]|U|W1|H)區/);
  for(const car of ['RFW7651','RFX6095','BKP0190'])assert.ok((await cards.allTextContents()).some(text=>text.replaceAll('-','').includes(car)));
  await page.locator('.area-jump-dropdown summary').click();
  assert.equal(await page.locator('.area-jump-panel button').filter({hasText:/^O$/}).count(),1);
  assert.equal(await page.locator('.area-jump-panel button').filter({hasText:/^ZH$/}).count(),0);
  await page.evaluate(()=>{
    window.jumpTarget='';HTMLElement.prototype.scrollIntoView=function(){window.jumpTarget=this.id};
  });
  await page.locator('.area-jump-panel').getByRole('button',{name:'O',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.jumpTarget),await cards.first().getAttribute('id'));
  await page.reload();
})

test('admin saves an editable area/car/work-focus configuration effective the next day', async()=>{
  await page.reload();
  await page.evaluate(()=>{
    window.manualPickerTest=true;window.manualAudits=[];
    window.formalByDate={'2026-09-09':structuredClone(window.fixture.template)};
    window.showManager();
  });
  await page.locator('.dispatch-table tbody tr').first().getByRole('button',{name:'修改',exact:true}).click();
  const modal=page.locator('.admin-edit-grid');
  await modal.getByLabel('區域名稱',{exact:true}).fill('管理員自訂區域');
  await modal.getByLabel('車號',{exact:true}).fill('NEW-1234');
  await modal.locator('label').filter({hasText:/^工作重點/}).locator('textarea').fill('新版工作重點');
  await page.getByRole('button',{name:'套用為新版配置',exact:true}).click();
  await modal.waitFor({state:'hidden'});
  const result=await page.evaluate(()=>({versions:window.configVersions,audits:window.manualAudits}));
  assert.equal(result.versions.length,1);
  assert.equal(result.versions[0].effectiveFrom,'2026-09-10');
  assert.equal(result.versions[0].manualPeople,false);
  assert.equal(result.versions[0].values.areaName,'管理員自訂區域');
  assert.equal(result.versions[0].values.vehicleNo,'NEW-1234');
  assert.equal(result.versions[0].values.workFocus,'新版工作重點');
  assert.equal(result.audits[0].mode,'version');
  await page.reload();
})

test('manual dispatch searches active employees without roster or shift restrictions and audits saves', async () => {
  await page.reload()
  await page.evaluate(() => {
    window.manualPickerTest=true;window.manualAudits=[];
    window.formalByDate={'2026-09-09':structuredClone(window.fixture.template)};
    window.fixture.employees.find(p=>p.employeeId==='B0410').active=true;
    window.fixture.employees.push({employeeId:'TEST0001',name:'未排班測試員工',title:'PT-支援',active:true},
      {employeeId:'INACTIVE0001',name:'離職測試員工',title:'PT',active:false});
    window.showManager();
  })
  const picker=page.locator('.dispatch-person-picker');
  for(const shift of ['day','night']) {
    await page.locator('select').first().selectOption(shift);
    const row=page.locator('.dispatch-table tbody tr').filter({hasText:'藝文 O1'}).first();
    await row.getByRole('button',{name:'修改',exact:true}).click();
    for(const search of ['B0410','0410','陳均瑜']) {
      await picker.locator('input').fill(search);
      assert.equal(await picker.locator('article').count(),1);
      assert.match(await picker.textContent(),/陳均瑜/);
    }
    await picker.getByRole('button',{name:'駐點',exact:true}).click();
    await picker.getByRole('button',{name:'駐點',exact:true}).click();
    await picker.locator('input').fill('未排班測試員工');
    await picker.getByRole('button',{name:'駐點',exact:true}).click();
    await picker.locator('input').fill('INACTIVE0001');
    assert.equal(await picker.locator('article').count(),0);
    await page.getByRole('button',{name:'儲存本日',exact:true}).click();
    await picker.waitFor({state:'hidden'});
  }
  const saved=await page.evaluate(()=>({blocks:window.formalByDate['2026-09-09'],audits:window.manualAudits}));
  assert.equal(saved.audits.length,2);
  for(const shift of ['day','night']) {
    const manual=saved.blocks.filter(b=>b.shiftType===shift&&b.modifiedBy==='test');
    assert.equal(manual.length,1);
    for(const id of ['B0410','TEST0001'])assert.equal(manual[0].stations.filter(p=>p.employeeId===id).length,1);
    const audit=saved.audits.find(a=>a.blockId===manual[0].blockId);
    assert.equal(audit.modifiedBy,'test');assert.equal(audit.date,'2026-09-09');
    assert.ok(audit.createdAt);assert.ok(audit.before);assert.ok(audit.after.stations.some(p=>p.employeeId==='TEST0001'));
  }
  await page.reload();
})

test('9/9 ordinary saved blocks use schedule people rather than automatic Google people', async () => {
  await page.waitForSelector('.dispatch-card .person')
  // Seven formerly omitted 晚夜 slots, across six people, now reach night blocks.
  assert.equal(await page.locator('.dispatch-card .person').count(), 108)
  assert.equal(await page.locator('.dispatch-card .person').filter({ hasText: '陳均瑜' }).count(), 1)
  await page.getByRole('button', { name: '早班', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tab.active')?.textContent === '早班')
  assert.equal(await page.locator('.dispatch-card .person').filter({ hasText: '陳均瑜' }).count(), 1)
  await page.getByRole('button', { name: '夜班', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tab.active')?.textContent === '夜班')
  assert.equal(await page.evaluate(() => window.templateReads), 0)
  assert.equal(await page.getByRole('button', {name: '＋ 帶入當日派工單（Google）'}).count(), 0)
  assert.deepEqual(errors, [])
  assert.equal(await page.evaluate(() => window.writeAttempts), 0)
})

test('9/13 front cards render the existing day/night assignment preview', async () => {
  await page.locator('input[type=date]').fill('2026-09-13')
  await page.waitForFunction(() => !document.querySelector('.loading') && document.querySelector('.dispatch-card .person'))
  const night = await page.locator('.dispatch-card .person').count()
  assert.ok(night > 0)
  await page.getByRole('button', { name: '早班', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tab.active')?.textContent === '早班')
  const day = await page.locator('.dispatch-card .person').count()
  assert.ok(day > 0)
  console.log('9/13 rendered front positions', { day, night })
  const { assignSchedulesToDispatchBlocks } = await server.ssrLoadModule('/lib/dispatch-schedule-assignment.ts')
  const { buildDispatchPreviewBlocks } = await server.ssrLoadModule('/lib/dispatch-blocks-firestore.ts')
  for (const [shift, count] of [['day', day], ['night', night]]) {
    const result = assignSchedulesToDispatchBlocks({ blocks: buildDispatchPreviewBlocks(template, '2026-09-13'), schedules: schedules['2026-09-13'], employees, shift })
    assert.equal(result.unmatched.length, 0)
    assert.equal(count, result.blocks.reduce((sum, block) => sum + block.drivers.length + block.stations.length, 0))
  }
  assert.deepEqual(errors, [])
  assert.equal(await page.evaluate(() => window.writeAttempts), 0)
})

test('slow old date responses cannot replace the current selected date', async () => {
  await page.evaluate(() => { window.delays = { '2026-09-09': 400 } })
  await page.locator('input[type=date]').fill('2026-09-09')
  await page.locator('input[type=date]').fill('2026-09-13')
  await page.waitForFunction(() => !document.querySelector('.loading') && document.querySelector('.dispatch-card .person'))
  const count = await page.locator('.dispatch-card .person').count()
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(await page.locator('.dispatch-card .person').count(), count)
})

test('1920px early/night tables have identical fixed date and pinned-column widths', async () => {
  const results = []
  for (const shift of ['morning', 'night']) {
    await page.evaluate(shift => window.showSchedule(shift), shift)
    await page.waitForSelector('.schedule-matrix')
    results.push(await page.locator('.schedule-matrix').evaluate(table => ({
      headers: [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
      dates: [...table.querySelectorAll('tbody tr:not(.area-heading) td:nth-child(n+4)')].map(cell => cell.getBoundingClientRect().width),
    })))
  }
  assert.deepEqual(results[0].headers, results[1].headers)
  assert.deepEqual(results[0].headers.slice(0, 3), [145, 85, 105])
  for (const result of results) assert.ok([...result.headers.slice(3), ...result.dates].every(width => width === 60))
})

test('long schedule code occupies at most two lines without break-all', async () => {
  const cell = page.locator('.schedule-matrix tbody td').filter({ hasText: /^府夜21-01$/ }).first()
  assert.ok(await cell.count(), 'real source must include the acceptance sample')
  const layout = await cell.evaluate(element => {
    const text = element.firstChild
    const tops = new Set()
    for (let i = 0; i < text.textContent.length; i++) {
      const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1)
      tops.add(Math.round(range.getBoundingClientRect().top))
    }
    return { lines: tops.size, wordBreak: getComputedStyle(element).wordBreak }
  })
  assert.ok(layout.lines <= 2)
  assert.notEqual(layout.wordBreak, 'break-all')
  assert.equal(await cell.evaluate(el=>getComputedStyle(el).cursor),'default');
  assert.equal(await cell.evaluate(el=>getComputedStyle(el).caretColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.schedule-matrix input,.schedule-matrix textarea,.schedule-matrix [contenteditable]').count(),0);
  console.log('府夜21-01 rendered lines', layout.lines)
})

test('admin source-group table scrolls within the viewport and retains pinned header/columns', async () => {
  await page.evaluate(() => window.showAdminSchedule())
  await page.waitForFunction(() => document.querySelectorAll('.admin-schedule tbody tr[data-employee-id]').length === 592)
  const measure = () => page.locator('.admin-schedule-wrap').evaluate(wrap => {
    const table = wrap.querySelector('table')
    return {
      bottom: wrap.getBoundingClientRect().bottom, height: wrap.clientHeight, scrollHeight: wrap.scrollHeight,
      horizontal: wrap.scrollWidth > wrap.clientWidth, overflowX: getComputedStyle(wrap).overflowX,
      headTop: table.querySelector('thead th:nth-child(4)').getBoundingClientRect().top,
      pinnedLefts: [...table.querySelector('tbody tr[data-employee-id]').children].slice(0, 3).map(cell => cell.getBoundingClientRect().left),
      widths: [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
    }
  })
  const before = await measure()
  assert.ok(before.bottom <= 1080 && before.height > 500)
  assert.ok(before.scrollHeight > before.height * 10)
  assert.equal(before.horizontal, true)
  assert.equal(before.overflowX, 'scroll')
  assert.deepEqual(before.widths.slice(0, 3), [130, 75, 90])
  assert.ok(before.widths.slice(3).every(width => width === 60))
  const sizes=await page.locator('.admin-schedule-page .admin-page-toolbar').evaluate(el=>[...el.querySelectorAll('.area-jump-dropdown summary,.schedule-group-switch button,input')].map(e=>({height:e.getBoundingClientRect().height,radius:getComputedStyle(e).borderRadius,font:getComputedStyle(e).fontSize,padding:getComputedStyle(e).padding,border:getComputedStyle(e).borderWidth,bottom:e.getBoundingClientRect().bottom})));
  assert.ok(sizes.every(size=>JSON.stringify(size)===JSON.stringify(sizes[0])),JSON.stringify(sizes));
  await page.locator('.admin-schedule-wrap').evaluate(wrap => { wrap.scrollTop = 1000; wrap.scrollLeft = wrap.scrollWidth })
  const after = await measure()
  assert.ok(Math.abs(after.headTop - before.headTop) <= 1)
  assert.deepEqual(after.pinnedLefts, before.pinnedLefts)
  assert.equal(after.bottom, before.bottom)
  console.log('admin viewport scroll', { bottom: before.bottom, height: before.height, columnWidth: before.widths[3] })
})

async function assertScheduleNavigation(tableSelector, wrapSelector, group) {
  const table = page.locator(tableSelector), wrap = page.locator(wrapSelector);
  const expected = scheduleSections(employees, group);
  const ids = await table.locator('tr[data-employee-id]').evaluateAll(rows => rows.map(row => row.dataset.employeeId));
  assert.deepEqual(ids, expected.flatMap(section => section.people.map(person => person.employeeId)));
  assert.deepEqual(await table.locator('.area-heading .area-label,.admin-source-heading span').allTextContents(),expected.map(section=>section.label));
  const wLabels=await table.locator('tr[data-area-code^="W"] .area-label,tr[data-area-code^="W"] span').allTextContents();
  assert.deepEqual(wLabels,group==='day'?['W1區','W2區','W3區']:['W1區','W2區']);
  assert.equal(await table.locator('.area-heading,.admin-source-heading').filter({hasText:/晚PT數字|BBK-0278|J2區/}).count(),0);
  const codes = await table.locator('tr[data-area-code]').evaluateAll(rows => rows.map(row => row.dataset.areaCode));
  assert.equal(codes.length, new Set(codes).size);
  assert.equal(codes.filter(code => code === 'O1').length, 1);
  await page.locator('.area-jump-dropdown summary').click();
  const panel = page.locator('.area-jump-panel');
  assert.deepEqual(await panel.locator('button').allTextContents(), getAreaJumpOptions(expected).map(section => section.label));
  const geometry = await panel.evaluate(el => ({height:el.clientHeight, scroll:el.scrollHeight, overflow:getComputedStyle(el).overflowY}));
  assert.ok(geometry.height <= 290 && geometry.scroll > geometry.height);
  assert.equal(geometry.overflow, 'auto');
  await panel.hover();
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('.area-jump-panel').scrollTop > 0);
  await wrap.evaluate(el => {el.scrollLeft = 100});
  const horizontal = await wrap.evaluate(el => el.scrollLeft);
  await panel.getByRole('button', {name:'O', exact:true}).click();
  assert.equal(await page.locator('.area-jump-dropdown').getAttribute('open'), null);
  const position = await wrap.evaluate(el => ({
    left:el.scrollLeft,
    gap:el.querySelector('tr[data-area-code="O1"]').getBoundingClientRect().top - el.querySelector('thead th').getBoundingClientRect().bottom,
  }));
  assert.equal(position.left, horizontal);
  assert.ok(Math.abs(position.gap) <= 2, JSON.stringify(position));
  assert.deepEqual(await table.locator('tr[data-employee-id]').evaluateAll(rows => rows.map(row => row.dataset.employeeId)), ids);
  console.log('schedule navigation', {group, people:ids.length, areas:codes.length, ...geometry});
}

test('front source sections are unique; bounded area dropdown scrolls without filtering and switches with tabs', async () => {
  await page.evaluate(() => window.showScheduleView());
  await page.waitForSelector('.schedule-matrix');
  await assertScheduleNavigation('.schedule-matrix', '.matrix-wrap', 'day');
  await page.getByRole('button', {name:'夜班',exact:true}).click();
  await assertScheduleNavigation('.schedule-matrix', '.matrix-wrap', 'night');
  await page.screenshot({path:'output/schedule-area-jump-front-1920.png'});
  await page.locator('.area-jump-dropdown summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.area-jump-dropdown').getAttribute('open'), null);
  await page.getByRole('button', {name:'我的班表',exact:true}).click();
  assert.equal(await page.locator('.area-jump-dropdown').count(), 0);
  assert.equal(await page.locator('.month-day').count(), 30);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', {name:'夜班',exact:true}).click();
  await assertScheduleNavigation('.schedule-matrix', '.matrix-wrap', 'night');
  assert.ok(await page.locator('.matrix-wrap').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path:'output/schedule-area-jump-front-mobile.png'});
  await page.setViewportSize({width:1920,height:1080});
});

test('formal admin matrix shares source sections; navigation preserves search, month, and readonly cells', async () => {
  await page.evaluate(() => window.showAdminSchedule());
  await page.waitForFunction(() => document.querySelectorAll('.admin-schedule tr[data-employee-id]').length === 592);
  await assertScheduleNavigation('.admin-schedule', '.admin-schedule-wrap', 'day');
  await page.getByRole('button', {name:'大小夜班',exact:true}).click();
  await assertScheduleNavigation('.admin-schedule', '.admin-schedule-wrap', 'night');
  await page.screenshot({path:'output/schedule-area-jump-admin-1920.png'});
  assert.equal(await page.locator('.admin-schedule td button:not(:disabled)').count(), 0);
  assert.equal(await page.getByLabel('月份', {exact:true}).inputValue(), '2026-09');
  await page.getByPlaceholder('員編或姓名').fill('96504');
  assert.equal(await page.locator('.admin-schedule tr[data-employee-id]').count(), 1);
  await page.locator('.area-jump-dropdown summary').click();
  assert.deepEqual(await page.locator('.area-jump-panel button').allTextContents(), ['O']);
  await page.getByPlaceholder('員編或姓名').fill('');
  assert.equal(await page.locator('.admin-schedule tr[data-employee-id]').count(), 158);
  assert.equal(await page.evaluate(() => window.writeAttempts), 0);
  assert.deepEqual(errors, []);
});

test('admin cell editor selects existing leave/area codes, confirms saves and cancels without browser prompt', async () => {
  await page.evaluate(() => {window.scheduleEdits=[];window.showAdminSchedule(true)});
  await page.getByPlaceholder('員編或姓名').fill('96504');
  const button=page.locator('.admin-schedule tr[data-employee-id="96504"] td[data-date-column] button').nth(8);
  await button.click();
  const editor=page.getByRole('dialog');
  await editor.waitFor();
  assert.equal(await editor.locator('input,textarea,[contenteditable]').count(),0);
  await editor.getByRole('button',{name:'慰',exact:true}).click();
  await editor.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.scheduleEdits.length),0);
  await button.click();
  await editor.getByRole('tab',{name:'區域',exact:true}).click();
  await editor.getByRole('button',{name:'O4',exact:true}).click();
  await editor.getByRole('button',{name:'夜O4',exact:true}).click();
  await page.screenshot({path:'output/schedule-cell-editor-1920.png'});
  await editor.getByRole('button',{name:'儲存修改',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.scheduleEdits.length),0);
  await editor.getByRole('button',{name:'確認儲存',exact:true}).click();
  await editor.waitFor({state:'hidden'});
  assert.equal(await button.textContent(),'夜O4');
  assert.deepEqual(await page.evaluate(()=>window.scheduleEdits.map(({employeeId,date,after})=>({employeeId,date,after}))),[{employeeId:'96504',date:'2026-09-09',after:'夜O4'}]);
  assert.equal(await page.evaluate(()=>window.writeAttempts),0);
});

test('monitor display uses one person per populated row without empty city placeholders', async () => {
  for (const [taipei, newTaipei] of [[['黃銀堂', '曾芳英'], []], [['柯勃甫'], ['周義順']], [[], ['周義順']], [[], []]]) {
    await page.evaluate(([a, b]) => window.showMonitors(a, b), [taipei, newTaipei])
    await page.waitForFunction(() => Boolean(document.querySelector('.duty-staff')))
    const actual = await page.locator('.duty-staff > div > span').allTextContents()
    assert.deepEqual(actual, [...taipei, ...newTaipei])
    assert.deepEqual(await page.locator('article > div > span').allTextContents(), actual)
    assert.equal(await page.getByText('未排定', { exact: true }).count(), 0)
  }
})

test('home displays the current Chinese date and three concise actions as read-only headings', async () => {
  await page.evaluate(() => window.showHome())
  await page.waitForSelector('.home-overview')
  assert.equal(await page.locator('.home-date').textContent(), '2026年9月9日')
  assert.equal(await page.locator('.home-overview h1').textContent(), '工作總覽')
  assert.deepEqual(await page.locator('.home-actions strong').allTextContents(), ['我的班表', '派工單', '請假申請'])
  assert.equal(await page.locator('.home-overview input, .home-overview textarea, .home-overview [contenteditable]').count(), 0)
  assert.equal(await page.locator('.home-date').evaluate(element => getComputedStyle(element).cursor), 'default')
})

test('only daytime front monitors group three per row; directors and night remain unchanged', async () => {
  const taipei = ['黃啟哲', '陳威宇', '陳韋傑', '江俊翰', '高秉森', '柯勃甫', '曾芳英']
  for (const count of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const staff = {directors: ['劉志強'], deputyDirectors: ['蔡文翔', '鄒正宇'], taipeiMonitors: taipei.slice(0, count), newTaipeiMonitors: ['周義順']}
    await page.evaluate(staff => window.showFrontDuty('day', staff), staff)
    await page.waitForFunction(count => document.querySelectorAll('.duty-staff > div > span').length === 3 + Math.ceil(count / 3), count)
    const expected = ['劉志強', '蔡文翔、鄒正宇']
    for (let index = 0; index < count; index += 3) expected.push(taipei.slice(index, Math.min(index + 3, count)).join('、'))
    expected.push('周義順')
    assert.deepEqual(await page.locator('.duty-staff > div > span').allTextContents(), expected)
    assert.deepEqual(await page.locator('.duty-staff > div > b').allTextContents(), ['調度主任', '調度副主任', ...Array(Math.ceil(count / 3)).fill('台北監控'), '新北監控'])
    await page.evaluate(staff => window.showFrontDuty('night', staff), staff)
    await page.waitForFunction(count => document.querySelectorAll('.duty-staff > div > span').length === count + 1, count)
    assert.deepEqual(await page.locator('.duty-staff > div > span').allTextContents(), [...taipei.slice(0, count), '周義順'])
    assert.equal(await page.getByText('調度主任', {exact: true}).count(), 0)
  }
})

test('Dashboard keeps unique-person counts distinct from compound assignment positions', async () => {
  await page.evaluate(() => window.showDashboard())
  await page.waitForFunction(() => document.querySelector('.dispatch-summary .admin-stat strong')?.textContent === '369')
  const labels = await page.locator('.dispatch-summary .admin-stat > span').allTextContents()
  assert.deepEqual(labels, ['日班出勤人數', '夜班出勤人數', '日班出車數', '夜班出車數', '多人共車數', '閒置車輛', '待人工調整人數'])
  assert.deepEqual(await page.locator('.dispatch-summary .admin-stat > strong').allTextContents(), ['369', '107', '89', '94', '58', '53', '0'])
  assert.doesNotMatch(await page.locator('.dispatch-summary').textContent(), /blocks|原始派工位置|原始識別人數/)
})

test('Google button fetches only after confirmation and complete imported people override assignment', async () => {
  await page.evaluate(() => window.showManager())
  await page.waitForSelector('.dispatch-table tbody tr')
  await page.locator('input[type=date]').fill('2026-09-13')
  await page.waitForSelector('.admin-preview-note')
  assert.equal(await page.evaluate(() => window.importCalls.length), 0)
  await page.getByRole('button', {name: '＋ 帶入當日派工單（Google）'}).click()
  await page.getByRole('button', {name: '取消', exact: true}).click()
  assert.equal(await page.evaluate(() => window.importCalls.length), 0)
  await page.getByRole('button', {name: '＋ 帶入當日派工單（Google）'}).click()
  await page.getByRole('button', {name: '確認帶入', exact: true}).click()
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('已帶入'))
  assert.deepEqual(await page.evaluate(() => window.importCalls), [{date: '2026-09-13', confirmed: true}])
  await page.evaluate(() => window.showDispatch())
  await page.waitForSelector('.dispatch-toolbar input[type=date]')
  await page.locator('input[type=date]').fill('2026-09-13')
  const expected = await page.evaluate(() => window.formalByDate['2026-09-13'].filter(b=>b.shiftType==='night').reduce((n,b)=>n+b.drivers.length+b.stations.length+b.assistants.length,0));
  await page.waitForFunction(expected => document.querySelectorAll('.dispatch-card .person').length === expected, expected)
  assert.equal(await page.locator('.dispatch-card .person').count(), expected)
  assert.equal(await page.evaluate(() => window.writeAttempts), 0)
})

test('pending assignments stay collapsed, open a bounded list, and hide when zero', async () => {
  await page.reload()
  await page.evaluate(() => window.showManager())
  await page.waitForSelector('.dispatch-table tbody tr')
  assert.equal(await page.locator('.dispatch-pending-summary').count(), 0)
  assert.equal(await page.getByRole('button', {name: '查看名單', exact: true}).count(), 0)

  await page.evaluate(() => {
    window.fixture.schedules['2026-09-13'] = window.fixture.schedules['2026-09-09']
      .filter(person => person.shiftType === 'morning').slice(0, 164)
      .map(person => ({...person, date: '2026-09-13', scheduleCode: '早A1'}))
    window.formalByDate = {'2026-09-13': window.fixture.template.map(block => ({
      ...block, date: '2026-09-13', modifiedBy: 'manual-import', drivers: [], stations: [], assistants: [],
    }))}
  })
  await page.locator('input[type=date]').fill('2026-09-13')
  await page.waitForFunction(() => document.querySelector('.dispatch-pending-summary strong')?.textContent === '待人工調整：164 人')
  assert.equal(await page.locator('.dispatch-pending-list').count(), 0)
  assert.equal(await page.locator('.dispatch-pending-summary').textContent(), '待人工調整：164 人查看名單')
  await page.getByRole('button', {name: '查看名單', exact: true}).click()
  assert.equal(await page.locator('.dispatch-pending-list tbody tr').count(), 164)
  assert.deepEqual(await page.locator('.dispatch-pending-list th').allTextContents(), ['員編','姓名','班表代碼','目前區域','待調整原因'])
  assert.match(await page.locator('.dispatch-pending-list tbody tr').first().textContent(), /早A1尚未派工該區 派工區塊 已由人工修改/)
  const listSize = await page.locator('.dispatch-pending-list').evaluate(element => ({height: element.clientHeight, scroll: element.scrollHeight}))
  assert.ok(listSize.scroll > listSize.height)
  assert.ok(listSize.height <= 648)
  await page.locator('.admin-modal > header button').click()
  assert.equal(await page.locator('.dispatch-pending-list').count(), 0)
  await page.getByRole('button', {name: '查看名單', exact: true}).click()
  await page.locator('.admin-page-toolbar select').first().selectOption('night')
  await page.waitForFunction(() => !document.querySelector('.dispatch-pending-summary'))
  assert.equal(await page.locator('.dispatch-pending-list').count(), 0)
  await page.locator('.admin-page-toolbar select').first().selectOption('day')
  await page.getByRole('button', {name: '查看名單', exact: true}).click()
  await page.locator('input[type=date]').fill('2026-09-09')
  await page.waitForFunction(() => !document.querySelector('.dispatch-pending-summary'))
  assert.equal(await page.locator('.dispatch-pending-list').count(), 0)
  assert.equal(await page.evaluate(() => window.writeAttempts), 0)
  assert.deepEqual(await page.evaluate(() => window.importCalls), [])
})

test('dispatch shares bounded area navigation without filtering or reordering cards',async()=>{
  await page.reload();await page.evaluate(()=>window.showDispatch());
  await page.waitForSelector('.dispatch-card .person');
  for(const shift of ['夜班','早班']) {
    await page.getByRole('button',{name:shift,exact:true}).click();
    const cards=await page.locator('.dispatch-card').evaluateAll(elements=>elements.map(el=>el.id));
    const codes=await page.locator('.dispatch-card[data-area-code]').evaluateAll(elements=>[...new Set(elements.map(el=>el.dataset.areaCode))]);
    await page.locator('.area-jump-dropdown summary').click();
    assert.equal(await page.locator('.area-jump-panel button').count(),getAreaJumpOptions(codes.map(code=>({areaCode:code,label:code,key:code}))).length);
    const firstTarget=await page.locator('.dispatch-card[data-area-code="O1"]').first().getAttribute('id');
    await page.locator('.area-jump-panel').getByRole('button',{name:'O',exact:true}).click();
    assert.equal(await page.locator('.area-jump-dropdown').getAttribute('open'),null);
    assert.ok(await page.locator(`[id="${firstTarget}"]`).evaluate(el=>Math.abs(el.getBoundingClientRect().top-80)<3));
    assert.deepEqual(await page.locator('.dispatch-card').evaluateAll(elements=>elements.map(el=>el.id)),cards);
  }
  assert.equal(await page.evaluate(()=>window.writeAttempts),0);
});

test('system switches animate, persist, require dispatch confirmation and retain state on failure',async()=>{
  await page.evaluate(()=>{window.features=undefined;window.settingsWrites=0;window.showSettings()});
  const attendance=page.getByRole('switch',{name:'打卡備案',exact:true});
  await attendance.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role=switch]').hasAttribute('disabled'));
  assert.equal(await attendance.getAttribute('aria-checked'),'false');
  const off=await attendance.evaluate(el=>({color:getComputedStyle(el).backgroundColor,transform:getComputedStyle(el.firstElementChild).transform,transition:getComputedStyle(el.firstElementChild).transitionDuration}));
  assert.equal(off.color,'rgb(199, 51, 59)');assert.equal(off.transition,'0.22s');
  await attendance.click();await page.getByText('打卡備案已儲存',{exact:true}).waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[role=switch]')).backgroundColor==='rgb(33, 132, 72)');
  assert.notEqual(await attendance.evaluate(el=>getComputedStyle(el.firstElementChild).transform),off.transform);
  await page.getByRole('switch',{name:'廣播功能',exact:true}).click();await page.getByText('廣播功能已儲存',{exact:true}).waitFor();
  await page.getByRole('switch',{name:'正式派工',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.features.dispatchEnabled),true);
  await page.getByRole('switch',{name:'正式派工',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'確認變更',exact:true}).click();
  await page.getByText('正式派工已儲存',{exact:true}).waitFor();
  await page.evaluate(()=>{window.failSettings=true});
  await page.getByRole('switch',{name:'廣播功能',exact:true}).click();
  await page.getByText('設定儲存失敗，請確認管理員權限或網路。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'廣播功能',exact:true}).getAttribute('aria-checked'),'false');
  await page.evaluate(()=>{window.failSettings=false;window.showHome()});await page.evaluate(()=>window.showSettings());
  await page.waitForFunction(()=>document.querySelector('[aria-label="正式派工"]').getAttribute('aria-checked')==='false');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="打卡備案"]')).backgroundColor==='rgb(33, 132, 72)');
  await page.screenshot({path:'output/system-feature-switches-1920.png'});
});

test('persisted flags control real employee navigation, open pages and broadcast popups',async()=>{
  await page.evaluate(()=>{window.broadcastLoads=0;window.testBroadcasts=[{id:'flag-test',title:'測試即時廣播',content:'測試',type:'general',targetType:'all',targetValues:[],active:true,popupMode:'always'}];window.showFullApp()});
  await page.waitForSelector('.home-overview');
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'打卡',exact:true}).count(),1);
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'廣播事項',exact:true}).count(),0);
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'派工單',exact:true}).count(),0);
  assert.equal(await page.locator('.home-actions').getByText('派工單',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.broadcastLoads),0);
  await page.evaluate(()=>{window.features={...window.features,attendanceEnabled:false,broadcastsEnabled:true,dispatchEnabled:true};window.featureListeners.forEach(next=>next({data:()=>window.features}));});
  await page.getByText('測試即時廣播',{exact:true}).waitFor();
  await page.evaluate(()=>{window.features={...window.features,broadcastsEnabled:false};window.featureListeners.forEach(next=>next({data:()=>window.features}));});
  await page.getByText('測試即時廣播',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'打卡',exact:true}).count(),0);
  await page.locator('.sidebar').getByRole('button',{name:'派工單',exact:true}).click();
  await page.waitForSelector('.dispatch-card');
  await page.evaluate(()=>{window.features={...window.features,dispatchEnabled:false};window.featureListeners.forEach(next=>next({data:()=>window.features}));});
  await page.getByText('此功能尚未開放',{exact:true}).waitFor();
  assert.equal(await page.locator('.dispatch-card').count(),0);
});

test('pre-schedule save text is readable and announcement uses 12 MB without changing its limit',async()=>{
  await page.evaluate(()=>window.showPreSettings());
  const button=page.getByRole('button',{name:'儲存時間',exact:true});
  const style=await button.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,opacity:getComputedStyle(el).opacity}));
  assert.notEqual(style.color,style.background);assert.equal(style.opacity,'1');
  await button.click();await page.getByRole('status').filter({hasText:'已儲存'}).waitFor();
  assert.match(await page.getByRole('status').textContent(),/最後儲存時間/);
  assert.notEqual(await page.getByRole('status').evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)');
  assert.match(readFileSync('app/admin-console.tsx','utf8'),/支援一般圖片格式，單檔上限 12 MB；系統會自動等比例縮圖，前台不裁切內容。/);
  assert.match(readFileSync('lib/announcements.ts','utf8'),/12 \* 1024 \* 1024/);
});

test('work focus preserves all text, front expands and admin collapses with a toggle',async()=>{
 const text='開始\nA1:第一區工作內容'.repeat(4)+'\nA2：第二區完整內容\nO1:最後不可省略';
 await page.evaluate(text=>window.showFocus(text,false),text);
 assert.equal(await page.locator('.work-focus-text').textContent(),text);
 assert.equal(await page.getByRole('button',{name:'展開',exact:true}).count(),0);
 assert.equal(await page.locator('.work-focus strong').count(),6);
 await page.evaluate(text=>window.showFocus(text,true),text);
 await page.getByRole('button',{name:'展開',exact:true}).click();
 assert.equal(await page.locator('.work-focus-text').textContent(),text);
 await page.getByRole('button',{name:'收合',exact:true}).click();
 assert.ok(await page.locator('.work-focus-text').evaluate(el=>el.scrollHeight>el.clientHeight));
});

test('admin whole-row move converts only original-area codes; remove/re-add is month scoped',async()=>{
 await page.reload();
 await page.evaluate(()=>{window.monthLayouts={};window.showAdminSchedule(true);});
 await page.locator('.admin-schedule tr[data-employee-id="93339"]').waitFor();
 const toolbar=page.locator('.admin-schedule-page > .admin-page-toolbar');
 await toolbar.getByPlaceholder('員編或姓名').fill('96504');
 await toolbar.getByRole('button',{name:'大小夜班',exact:true}).click();
 const before=await page.locator('.admin-schedule tr[data-employee-id="96504"] [data-date-column]').allTextContents();
 await page.getByRole('button',{name:'管理 96504 涂佑葦',exact:true}).click();
 await page.getByRole('button',{name:'換區',exact:true}).click();
 await page.getByLabel('區域',{exact:true}).selectOption('area:K1');
 await page.getByRole('button',{name:'儲存',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.deepEqual(await page.locator('.admin-schedule tr[data-employee-id="96504"] [data-date-column]').allTextContents(),before.map(code=>code.replaceAll('O1','K1')));
 await page.getByRole('button',{name:'管理 96504 涂佑葦',exact:true}).click();
 await page.getByRole('button',{name:'移出',exact:true}).click();
 await page.getByRole('button',{name:'儲存',exact:true}).click();
 await page.getByRole('button',{name:'確認移出',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('.admin-schedule tr[data-employee-id="96504"]').count(),0);
 // The fixture swaps React roots directly; wait for modal teardown (not merely
 // an inaccessible/hidden dialog) before replacing its owning screen.
 await page.locator('[role="dialog"]').waitFor({state:'detached'});
 await page.evaluate(()=>window.showDispatch());await page.locator('.dispatch-card').first().waitFor();
 assert.equal(await page.locator('.dispatch-card .person').filter({hasText:'96504'}).count(),0);
 await page.evaluate(()=>window.showAdminSchedule(true));await page.locator('.admin-schedule').waitFor();
 await toolbar.getByPlaceholder('員編或姓名').fill('96504');
 await toolbar.getByRole('button',{name:'大小夜班',exact:true}).click();
 await toolbar.getByRole('button',{name:'新增人員',exact:true}).click();
 await page.getByPlaceholder('員編／姓名').fill('96504');
 await page.getByRole('button',{name:'96504 涂佑葦',exact:true}).click();
 await page.getByLabel('組別',{exact:true}).selectOption('night');
 await page.getByLabel('區域',{exact:true}).selectOption('area:K1');
 await page.getByRole('button',{name:'儲存',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.ok((await page.locator('.admin-schedule tr[data-employee-id="96504"] [data-date-column]').allTextContents()).every(v=>v==='—'));
 await page.evaluate(()=>window.showHome());await page.evaluate(()=>window.showAdminSchedule(true));
 await page.locator('.admin-schedule').waitFor();await toolbar.getByPlaceholder('員編或姓名').fill('96504');await toolbar.getByRole('button',{name:'大小夜班',exact:true}).click();
 await page.locator('.admin-schedule tr[data-employee-id="96504"]').waitFor();
 assert.ok((await page.locator('.admin-schedule tr[data-employee-id="96504"] [data-date-column]').allTextContents()).every(v=>v==='—'));
});

test('four employee views share read-only text while real controls stay interactive', async () => {
  await page.reload();
  const checkText = async selector => {
    const nodes = page.locator(selector);
    assert.ok(await nodes.count(), selector);
    const failures = await nodes.evaluateAll(elements => elements.filter(el => {
      const style = getComputedStyle(el);
      return style.cursor !== 'default' || style.caretColor !== 'rgba(0, 0, 0, 0)' ||
        style.outlineStyle !== 'none' || el.isContentEditable ||
        el.matches('input,textarea,select,button,[tabindex]');
    }).map(el => el.outerHTML.slice(0, 180)));
    assert.deepEqual(failures, [], selector);
    const first = nodes.first();
    const appearance = () => first.evaluate(el => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.boxShadow, s.outlineStyle, s.transform];
    });
    const before = await appearance();
    await first.hover();
    await first.click();
    assert.deepEqual(await appearance(), before, 'display text has no editable hover/focus');
    assert.equal(await first.evaluate(el => document.activeElement === el), false);
  };
  for (const viewport of [{width:1920,height:1080},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.showScheduleView());
    await page.waitForSelector('.schedule-matrix');
    await page.getByRole('button', {name:'我的班表',exact:true}).click();
    await checkText('.personal-month :is(h2,.weekday,.month-day,.month-day small,.month-day strong)');
    assert.equal(await page.locator('.personal-month :is(input,textarea,[contenteditable])').count(), 0);
    for (const name of ['早班','夜班']) {
      const tab = page.getByRole('button', {name,exact:true});
      assert.equal(await tab.evaluate(el => getComputedStyle(el).cursor), 'pointer');
      await tab.click();
      await checkText('.schedule-matrix :is(th,td,th span,th small)');
      assert.equal(await page.locator('.schedule-matrix :is(input,textarea,[contenteditable])').count(), 0);
    }
    await page.evaluate(() => window.showDispatch());
    await page.waitForSelector('.dispatch-card .person');
    await checkText('.dispatch-card :is(header,header span,b,.person,.person small,.work-focus,.work-focus-text), .duty-staff :is(header,strong,b,span)');
    assert.equal(await page.locator('.dispatch-card :is(input,textarea,[contenteditable]),.duty-staff :is(input,textarea,[contenteditable])').count(), 0);
    const jump = page.locator('.area-jump-dropdown summary');
    assert.equal(await jump.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    assert.equal(await jump.locator('span').evaluate(el => getComputedStyle(el).cursor), 'pointer');
    await jump.click();
    assert.notEqual(await page.locator('.area-jump-dropdown').getAttribute('open'), null);
    await page.keyboard.press('Escape');
    await page.locator('input[type=date]').fill('2026-09-13');
    assert.equal(await page.locator('input[type=date]').inputValue(), '2026-09-13');
    assert.notEqual(await page.locator('input[type=date]').evaluate(el => getComputedStyle(el).caretColor), 'rgba(0, 0, 0, 0)');
    await page.waitForFunction(() => !document.querySelector('.loading') && document.querySelector('.dispatch-card .person'));
    assert.equal(await page.evaluate(() => window.writeAttempts), 0);
  }
  await page.setViewportSize({width:1920,height:1080});
});

test('night row management defaults to the existing monthly group, not day',async()=>{
 await page.evaluate(()=>{window.monthLayouts={};window.showHome();});
 await page.evaluate(()=>window.showAdminSchedule(true));
 await page.getByRole('button',{name:'大小夜班',exact:true}).click();
 await page.getByRole('button',{name:'管理 96504 涂佑葦',exact:true}).click();
 await page.getByRole('button',{name:'換區',exact:true}).click();
 assert.equal(await page.getByLabel('組別',{exact:true}).inputValue(),'night');
 await page.getByRole('button',{name:'關閉',exact:true}).click();
});

test('admin handle drags the whole row within a section; saved order reloads without code changes',async()=>{
 await page.reload();await page.evaluate(()=>window.showAdminSchedule(true));
 await page.locator('.admin-schedule tr[data-employee-id="93339"]').waitFor();
 await page.getByRole('button',{name:'大小夜班',exact:true}).click();
 const o1=scheduleSections(employees,'night').find(s=>s.areaCode==='O1').people.map(p=>p.employeeId);
 const first=page.locator(`tr[data-employee-id="${o1[0]}"]`),target=page.locator(`tr[data-employee-id="${o1[2]}"]`);
 const codes=await first.locator('[data-date-column]').allTextContents();
 await first.scrollIntoViewIfNeeded();
 const size=await target.boundingBox();
 await first.locator('.schedule-drag-handle').dragTo(target,{targetPosition:{x:50,y:size.height-3}});
 await page.getByText('順序已儲存',{exact:true}).waitFor();
 const order=()=>page.evaluate(ids=>[...document.querySelectorAll('tr[data-employee-id]')].map(r=>r.dataset.employeeId).filter(id=>ids.includes(id)),o1);
 assert.deepEqual(await order(),[o1[1],o1[2],o1[0],...o1.slice(3)]);
 assert.deepEqual(await first.locator('[data-date-column]').allTextContents(),codes);
 const writes=await page.evaluate(()=>window.rowCalls.length);
 const other=page.locator('tr[data-employee-id]').filter({has:page.locator('.schedule-drag-handle')}).first();
 // The positive path above uses a physical pointer drag. For the forbidden
 // cross-section drop, dispatch the browser drag events without scrolling the
 // entire 158-person matrix while a native OS drag is active.
 const transfer=await page.evaluateHandle(()=>new DataTransfer());
 await first.locator('.schedule-drag-handle').dispatchEvent('dragstart',{dataTransfer:transfer});
 await other.dispatchEvent('drop',{dataTransfer:transfer,clientY:1});
 await first.locator('.schedule-drag-handle').dispatchEvent('dragend',{dataTransfer:transfer});
 await transfer.dispose();
 assert.equal(await page.evaluate(()=>window.rowCalls.length),writes,'cross-section drag does not save');
 await page.evaluate(()=>window.showHome());await page.getByText('工作總覽',{exact:true}).first().waitFor();
 await page.evaluate(()=>window.showAdminSchedule(true));await page.getByRole('button',{name:'大小夜班',exact:true}).click();
 await page.locator(`tr[data-employee-id="${o1[0]}"]`).waitFor();assert.deepEqual(await order(),[o1[1],o1[2],o1[0],...o1.slice(3)]);
});

test('structure toolbar creates/renames/deletes empty sections; person modal only changes selected person',async()=>{
 await page.reload();await page.evaluate(()=>{
   // Exercise structural operations with real source staff; 750-person rendering
   // and drag coverage are tested separately above.
   window.fixture.monthSchedules=window.fixture.monthSchedules.filter(r=>['93339','93900','96504'].includes(r.employeeId));
   window.showAdminSchedule(true);
 });
 await page.locator('.admin-schedule tr[data-employee-id="93339"]').waitFor();
 const buttons=page.locator('.schedule-structure-actions button');
 assert.deepEqual(await buttons.allTextContents(),['新增人員','新增區域','刪除區域']);
 const heights=await buttons.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));assert.equal(new Set(heights).size,1);
 await page.getByRole('button',{name:'新增區域',exact:true}).click();
 await page.getByLabel('區域名稱',{exact:true}).fill('支援小隊');
 await page.getByRole('button',{name:'儲存',exact:true}).click();
 await page.locator('[role="dialog"]').waitFor({state:'detached'});
 await page.locator('.admin-source-heading span').filter({hasText:'支援小隊'}).waitFor();
 await page.getByRole('button',{name:'編輯區域名稱 支援小隊',exact:true}).click();
 await page.getByLabel('區域名稱',{exact:true}).fill('臨時支援');
 await page.getByRole('button',{name:'儲存',exact:true}).click();
 await page.locator('[role="dialog"]').waitFor({state:'detached'});
 await page.getByRole('button',{name:'管理 93339 蔡文翔',exact:true}).click();
 await page.getByRole('heading',{name:'班表人員異動',exact:true}).waitFor();
 const modal=page.getByRole('dialog');
 await modal.getByRole('button',{name:'換區',exact:true}).waitFor();
 await page.screenshot({path:'output/month-person-change-dialog.png'});
 for(const text of ['上移','下移','新增人員','取消','Close'])assert.equal(await modal.getByRole('button',{name:text,exact:true}).count(),0);
 assert.equal(await modal.getByRole('button',{name:'換區',exact:true}).count(),1);
 assert.equal(await modal.getByRole('button',{name:'移出',exact:true}).count(),1);
 await page.getByRole('button',{name:'換區',exact:true}).click();
 await page.getByLabel('區域',{exact:true}).selectOption({label:'臨時支援'});
 const before=await page.evaluate(()=>window.rowCalls.length);
 await page.getByRole('button',{name:'關閉',exact:true}).click();
 await page.locator('[role="dialog"]').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.rowCalls.length),before,'X discards unconfirmed changes');
 await page.getByRole('button',{name:'刪除區域',exact:true}).click();
 await page.getByLabel('區域',{exact:true}).selectOption({label:'臨時支援'});
 await modal.getByRole('button',{name:'刪除區域',exact:true}).click();
 await page.getByRole('button',{name:'確認刪除',exact:true}).click();
 await page.locator('[role="dialog"]').waitFor({state:'detached'});
 assert.equal(await page.locator('.admin-source-heading span').filter({hasText:'臨時支援'}).count(),0);
 await page.getByRole('button',{name:'刪除區域',exact:true}).click();
 await page.getByLabel('區域',{exact:true}).selectOption({label:'單位主官'});
 await modal.getByRole('button',{name:'刪除區域',exact:true}).click();await page.getByRole('button',{name:'確認刪除',exact:true}).click();
 await page.getByText('此區域仍有人員，請先換區或移出人員後再刪除。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'關閉',exact:true}).click();await page.locator('[role="dialog"]').waitFor({state:'detached'});
 const editWidth=await page.locator('.section-edit').first().evaluate(el=>el.getBoundingClientRect().width);
 assert.ok(editWidth<=30,'section pencil remains a small control, not a full-row button');
 await page.screenshot({path:'output/month-structure-admin-1920.png',fullPage:false});
 await page.evaluate(()=>window.showAdminSchedule(false));
 await page.waitForFunction(()=>document.querySelectorAll('.schedule-structure-actions,.schedule-drag-handle,.section-edit,.schedule-row-action').length===0);
});

test('employee navigation preserves two shift cards, highlights assistants, and never jumps for duty or missing employee', async()=>{
  await page.reload();
  await page.evaluate(()=>{
    const day=window.fixture.template.find(b=>b.shiftType==='day'&&b.areaCode==='O1');
    const night=window.fixture.template.find(b=>b.shiftType==='night'&&b.areaCode==='O1');
    window.formalByDate={'2026-09-09':[day,night].map(b=>({...b,modifiedBy:'admin',drivers:[],stations:[],assistants:[{employeeId:'B0410',employeeName:'陳均瑜'}]}))};
    window.scrolls=[];HTMLElement.prototype.scrollIntoView=function(){window.scrolls.push(this.id)};
    window.showDispatch('B0410');
  });
  await page.getByText('你今天有 2 筆派工',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.scrolls.length===1);
  assert.equal(await page.locator('.dispatch-self-person').count(),1);
  assert.match(await page.locator('.dispatch-self-person').textContent(),/陳均瑜/);
  assert.equal(await page.locator('.tabs .active').textContent(),'早班');
  await page.getByRole('button',{name:'下一筆',exact:true}).click();
  await page.waitForFunction(()=>window.scrolls.length===2);
  assert.equal(await page.locator('.tabs .active').textContent(),'夜班');
  assert.equal(await page.locator('.dispatch-self-person').count(),1);
  const ids=await page.evaluate(()=>window.scrolls);assert.notEqual(ids[0],ids[1]);
  await page.getByRole('button',{name:'上一筆',exact:true}).click();
  await page.waitForFunction(()=>window.scrolls.length===3);
  assert.equal(await page.evaluate(()=>window.scrolls[2]),ids[0]);
  for(const args of [['B0410',true],['NO-ASSIGNMENT',false]]){
    await page.evaluate(args=>{window.scrolls=[];window.showDispatch(...args)},args);
    await page.waitForFunction(()=>!document.querySelector('.loading')&&document.querySelector('.dispatch-card'));
    assert.equal(await page.locator('.dispatch-self-navigation,.dispatch-self-person').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.scrolls),[]);
  }
  await page.reload();
  await page.evaluate(()=>{
    const b=window.fixture.template.find(b=>b.shiftType==='night'&&b.areaCode==='O1');
    window.formalByDate={'2026-09-09':[{...b,modifiedBy:'admin',drivers:[{employeeId:'B0410',employeeName:'陳均瑜'}],stations:[],assistants:[]}]};
    window.scrolls=[];HTMLElement.prototype.scrollIntoView=function(){window.scrolls.push(this.id)};window.showDispatch('B0410');
  });
  await page.getByText('你今天有 1 筆派工',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.scrolls.length===1);
  assert.equal(await page.getByRole('button',{name:'下一筆',exact:true}).count(),0);
  await page.reload();
});

test('saving region X1 immediately reorders raw admin rows and front cards identically; save buttons share geometry',async()=>{
  await page.reload();await page.evaluate(()=>{
    window.manualPickerTest=true;window.manualAudits=[];
    window.formalByDate={'2026-09-09':window.fixture.template.map(b=>({...b,modifiedBy:'admin',drivers:[{employeeId:'MANUAL',employeeName:'人工'}],stations:[],assistants:[]}))};
    window.showManager();
  });
  await page.locator('select').first().selectOption('night');
  const row=page.locator('.dispatch-table tbody tr').filter({hasText:'RFW-7651'}).first();
  await row.getByRole('button',{name:'修改',exact:true}).click();
  await page.getByLabel('區域名稱',{exact:true}).fill('X1區');
  const geometry=await page.locator('.dispatch-save-actions button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {y:r.y,h:r.height,padding:s.padding,radius:s.borderRadius,bg:s.backgroundColor}}));
  assert.equal(geometry.length,2);for(const k of ['y','h','padding','radius'])assert.equal(geometry[0][k],geometry[1][k]);assert.notEqual(geometry[0].bg,geometry[1].bg);
  await page.screenshot({path:'output/dispatch-save-buttons.png'});
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.locator('.dispatch-save-actions button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {y:r.y,h:r.height,right:r.right}}));
  assert.equal(mobile[0].y,mobile[1].y);assert.equal(mobile[0].h,mobile[1].h);assert.ok(mobile[1].right<=390);
  await page.setViewportSize({width:1920,height:1080});
  await page.getByRole('button',{name:'儲存本日',exact:true}).click();
  await page.locator('.admin-edit-grid').waitFor({state:'hidden'});
  await row.getByText('X1區',{exact:true}).waitFor();
  const adminOrder=await page.locator('.dispatch-table tbody tr').evaluateAll(rows=>rows.map(r=>r.cells[1].textContent));
  assert.ok(adminOrder.indexOf('RFW-7651')>adminOrder.indexOf('RFX-6095'));
  const saved=await page.evaluate(()=>({rows:window.formalByDate['2026-09-09'],audits:window.manualAudits}));
  assert.equal(saved.rows.length,template.length);assert.equal(saved.audits.length,1);assert.equal(saved.audits[0].mode,'day');
  assert.equal(saved.rows.find(b=>b.vehicleNo==='RFW-7651'&&b.shiftType==='night').areaCode,'O1');
  await page.evaluate(()=>window.showDispatch());await page.locator('.dispatch-card').first().waitFor();
  const frontOrder=await page.locator('.dispatch-card').evaluateAll(cards=>cards.map(c=>c.querySelector('.dispatch-fields > span').textContent));
  assert.deepEqual(frontOrder,adminOrder);
  assert.equal(await page.locator('.dispatch-card[data-area-code="X1"]').filter({hasText:'RFW-7651'}).count(),1);
  await page.reload();
});

test('mobile dispatch back-to-top appears after scrolling and smoothly returns at three phone sizes; desktop stays hidden',async()=>{
  const measurements=[];
  for(const [width,height] of [[360,800],[390,844],[430,932]]){
    await page.setViewportSize({width,height});await page.reload();
    await page.locator('.dispatch-card').first().waitFor();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    const button=page.getByRole('button',{name:'回到頂部',exact:true});
    assert.equal(await button.count(),0);
    await page.evaluate(()=>window.scrollTo({top:250,behavior:'instant'}));
    await page.waitForFunction(()=>window.scrollY===250);assert.equal(await button.count(),0);
    await page.evaluate(()=>window.scrollTo({top:1000,behavior:'instant'}));await button.waitFor();
    const box=await button.boundingBox();assert.equal(box.width,44);assert.equal(box.height,44);
    assert.ok(width-box.x-box.width>=12);assert.ok(height-box.y-box.height>=16);
    assert.match(await button.evaluate(b=>getComputedStyle(b).backgroundColor),/0\.65\)/);
    measurements.push({width,height,button:box});
    await page.screenshot({path:`output/dispatch-back-top-${width}.png`});
    await page.evaluate(()=>{const original=window.scrollTo.bind(window);window.scrollTo=(options)=>{window.lastScrollOptions=options;original(options)}});
    await button.click();await page.waitForFunction(()=>window.scrollY===0);
    assert.equal(await button.count(),0);assert.equal(await page.evaluate(()=>window.lastScrollOptions.behavior),'smooth');
  }
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.locator('.dispatch-card').first().waitFor();
  await page.evaluate(()=>window.scrollTo({top:1000,behavior:'instant'}));await page.waitForFunction(()=>window.scrollY===1000);
  assert.equal(await page.getByRole('button',{name:'回到頂部',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'回到頂部',exact:true}).waitFor();
  await page.evaluate(()=>window.showHome());await page.getByText('工作總覽',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'回到頂部',exact:true}).count(),0);
  console.log('back-to-top phone measurements',JSON.stringify(measurements));
  await page.setViewportSize({width:1920,height:1080});await page.reload();
});
