import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { planScheduleLayoutOrder } from '../functions/schedule-sheet-domain.mjs';

// Synthetic employee data only; never import production Firebase/auth or read
// the live roster. This fixture deliberately reproduces new O sections at the
// end of a catalog and manually ordered rows scattered across section blocks.
const month = '2026-10';
const employee = (employeeId, group, area, extra = {}) => ({ employeeId, name: `測試${employeeId}`, title: '調度專員', active: true, group, area, ...extra });
const newcomers = { onboardingStartedAt: '2026-10-03T03:00:00.000Z', onboardingHighlightUntil: '2027-01-03T03:00:00.000Z' };
const people = [employee('P0002', 'day', 'O1'), employee('P0003', 'day', 'R'), employee('P0001', 'day', 'O1'),
  employee('N9001', 'day', 'O4', newcomers), employee('P0004', 'day', 'O3'), employee('B9001', 'day', 'O4'),
  employee('X9001', 'day', 'O4'), employee('P1002', 'night', 'O1'), employee('P1003', 'night', 'S'),
  employee('P1001', 'night', 'O1'), employee('N9002', 'night', 'O4', newcomers), employee('P1004', 'night', 'O3')];
const section = (group, areaCode, key = `area:${areaCode}`, label = `${areaCode}區`) => ({ group, areaCode, key, section: `${areaCode}區`, label });
const originalLayout = { monthKey: month, revision: 4, excludedEmployeeIds: ['X9001'], assignmentResetAt: { '2026-10-05': { P0001: { seconds: 1 } } },
  sections: [section('day', 'O1'), section('day', 'R'), section('day', 'O4'), section('day', 'O3', 'custom:day-o3', 'O3自訂名稱'), section('day', 'O2'),
    section('night', 'O1'), section('night', 'S'), section('night', 'O4'), section('night', 'O3', 'custom:night-o3', 'O3自訂名稱'), section('night', 'O2')],
  rows: people.map(p => ({ employeeId: p.employeeId, group: p.group, section: `${p.area}區`, areaCode: p.area,
    sectionKey: p.area === 'O3' ? `custom:${p.group}-o3` : `area:${p.area}`, blankDays: p.employeeId === 'B9001' ? Array.from({ length: 31 }, (_, i) => String(i + 1)) : [] })),
};
const original = structuredClone(originalLayout);
const changes = planScheduleLayoutOrder([originalLayout]);
assert.equal(changes.length, 1, 'The malformed layout must produce one order repair');
const normalized = changes[0].after;
assert.deepEqual(originalLayout, original, 'Planning must not mutate the original layout');
assert.deepEqual(new Map(normalized.rows.map(row => [row.employeeId, row])), new Map(original.rows.map(row => [row.employeeId, row])), 'Order repair must preserve every employee placement and blank day');
assert.deepEqual(new Map(normalized.sections.map(section => [`${section.group}:${section.key}`, section])), new Map(original.sections.map(section => [`${section.group}:${section.key}`, section])), 'Order repair must preserve each subgroup and custom title');
assert.deepEqual({ ...normalized, rows: original.rows, sections: original.sections }, original, 'Order repair must preserve the layout metadata');
assert.deepEqual(planScheduleLayoutOrder([normalized]), [], 'A repaired layout must be idempotent');
const records = people.filter(p => p.employeeId !== 'B9001').flatMap(p => Array.from({ length: 31 }, (_, i) => ({ id: `${p.employeeId}_${month}-${String(i + 1).padStart(2, '0')}`,
  employeeId: p.employeeId, employeeName: p.name, title: p.title, group: p.group, area: p.area, shiftType: p.group === 'day' ? 'morning' : 'night',
  date: `${month}-${String(i + 1).padStart(2, '0')}`, scheduleCode: i === 0 ? '休' : `${p.group === 'day' ? '早' : '夜'}${p.area}` })));
const fixture = { people, records, layout: originalLayout, normalized };
const reportDir = path.resolve('output/region-order-ui');
mkdirSync(reportDir, { recursive: true });
let builtCss;
if (process.env.REGION_ORDER_PAGES_DIR) {
  const html = readFileSync(path.join(process.env.REGION_ORDER_PAGES_DIR, 'index.html'), 'utf8');
  const href = html.match(/href="([^"]+\.css)"/)?.[1];
  assert.ok(href);
  builtCss = readFileSync(path.join(process.env.REGION_ORDER_PAGES_DIR, 'assets', path.basename(href)), 'utf8');
}
const appSource = readFileSync('app/page.tsx', 'utf8'), adminSource = readFileSync('app/admin-console.tsx', 'utf8');
const projectionSource = appSource.slice(appSource.indexOf('function scheduleRecordsToData('), appSource.indexOf('async function showEligibleBroadcasts('));
const scheduleSource = appSource.slice(appSource.indexOf('function ScheduleView('), appSource.indexOf('function EmptyNotice('));
const managerSource = adminSource.slice(adminSource.indexOf('function ScheduleManager('), adminSource.indexOf('function AnnouncementManager('));
const entry = `
  import React,{Fragment,useEffect,useMemo,useRef,useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {monthSections,initialMonthRows,monthSectionCatalog} from '/functions/month-schedule-layout.mjs';
  import {scheduleDisplayGroup,preScheduleSource} from '/functions/pre-schedule-order.mjs';
  import {eligibleMonthSchedules} from '/functions/month-schedule-policy.mjs';
  import sourceSchedule from '/public/september-schedules.json';
  import {AreaJumpDropdown,scheduleSectionId} from '/app/area-jump-dropdown.tsx';
  import {useNewHireClock} from '/app/use-new-hire-clock.ts';
  import {isNewHireHighlighted,newHireHighlightTitle} from '/lib/new-hire-highlight.mjs';
  import {buildScheduleEditCatalog} from '/lib/schedule-edit-catalog.ts';
  import '/app/globals.css'; import '/app/matrix.css'; import '/app/area-fix.css'; import '/app/youbike-theme.css';
  import '/app/mobile-nav.css'; import '/app/mobile-layout.css'; import '/app/admin-console.css'; import '/app/month-structure.css';
  import '/app/front-readonly.css'; import '/app/schedule-landscape.css'; import '/app/new-hire-highlight.css';
  const todayTaipei=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10),db={},collection=()=>({});
  const currentRecords=()=>eligibleMonthSchedules(window.fixture.records,window.fixture.layout);
  const getDocs=async()=>({docs:window.fixture.people.map(p=>({id:p.employeeId,data:()=>p}))});
  const getMonthLayout=async()=>window.fixture.layout,listMonthScheduleRecords=async()=>currentRecords();
  window.scheduleListeners=new Set();
  const subscribeMonthSchedule=(_month,callback)=>{window.scheduleListeners.add(callback);queueMicrotask(()=>callback(currentRecords(),window.fixture.people,window.fixture.layout));return()=>window.scheduleListeners.delete(callback)};
  window.publish=layout=>{window.fixture.layout=layout;window.scheduleListeners.forEach(callback=>callback(currentRecords(),window.fixture.people,layout))};
  const isLeave=code=>/休|例|慰|病|事|假|特/.test(code),ScheduleSheetSyncControls=()=>null,MonthRowManager=()=>null,MonthSectionManager=()=>null,ScheduleCellEditor=()=>null;
  const denyWrite=()=>{throw Error('Unexpected fixture write')},manageMonthRow=denyWrite,updateFormalScheduleCell=denyWrite,getScheduleRecord=denyWrite;
  ${projectionSource}
  ${scheduleSource}
  ${managerSource}
  const root=createRoot(document.getElementById('root'));let key=0;
  function Front({initialTab}){
    const [tab,setTab]=useState(initialTab),[data,setData]=useState(null);
    useEffect(()=>subscribeMonthSchedule('2026-10',(records,profiles,layout)=>setData(scheduleRecordsToData(records,profiles,layout,'2026-10'))),[]);
    return <div className="app-shell" data-page="schedule"><aside className="sidebar"/><main className="workspace"><header className="topbar">我的班表</header><section className="content"><ScheduleView tab={tab} setTab={setTab} data={data} employeeId="N9001"/></section></main></div>;
  }
  window.front=tab=>root.render(<Front key={key++} initialTab={tab}/>);
  window.admin=()=>root.render(<div className="admin-console"><aside className="admin-sidebar"/><main className="admin-main"><header className="admin-topbar">班表管理</header><section className="admin-content"><ScheduleManager key={key++} employeeId="fixture" admin={true}/></section></main></div>);
  window.front('morning');
`;
const server = await createServer({ configFile: false, logLevel: 'error', cacheDir: path.join(reportDir, 'vite-cache'),
  resolve: { alias: { '@': process.cwd() } }, optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'lucide-react'] },
  plugins: [react(), { name: 'region-order-fixture', enforce: 'pre',
    resolveId: id => id === 'region-order:entry' ? '\0region-order:entry' : undefined,
    async load(id) { if (id === '\0region-order:entry') return (await transformWithEsbuild(entry, 'region-order-entry.tsx', { loader: 'tsx', jsx: 'automatic', target: 'esnext' })).code; },
    configureServer(server) { server.middlewares.use('/region-order-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/region-order-test', '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@id/__x00__region-order:entry"></script>'));
    }); },
  }], server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
after(async () => { await browser.close(); await server.close(); });
async function open(viewport = { width: 1920, height: 1080 }) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') });
  await page.addInitScript(fixture => { window.fixture = fixture; }, fixture);
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/region-order-test`);
  await page.locator('tr[data-employee-id="N9001"]').waitFor();
  if (builtCss) await page.evaluate(css => {
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => node.remove());
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  }, builtCss);
  return { page, errors };
}
async function areas(page) { return page.locator('tr[data-area-code]').evaluateAll(rows => rows.map(r => r.dataset.areaCode)); }
async function expectOrder(page, expected) {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('tr[data-area-code]')].map(r => r.dataset.areaCode)) === JSON.stringify(expected), expected);
  assert.deepEqual(await areas(page), expected);
  const o = expected.map((code, i) => /^O\d*$/.test(code) ? i : -1).filter(i => i >= 0);
  assert.equal(o.at(-1) - o[0] + 1, o.length, 'All O sections must occupy one continuous range');
}
async function expectNewHire(page, employeeId) {
  const row = page.locator(`tr[data-employee-id="${employeeId}"]`);
  assert.equal(await row.getAttribute('data-new-hire'), 'true');
  assert.equal(await row.locator('.new-hire-badge').count(), 1);
  const colours = await row.evaluate(r => [...r.children].slice(0, 4).map(td => getComputedStyle(td).backgroundColor));
  assert.deepEqual(colours.slice(1, 3), ['rgb(255, 243, 107)', 'rgb(255, 243, 107)']);
  assert.notEqual(colours[0], colours[1]); assert.notEqual(colours[3], colours[1]);
}
void test('front live order repair keeps day/night O blocks adjacent, subgroup labels, manual row order and new-hire highlights', async () => {
  const { page, errors } = await open();
  try {
    assert.deepEqual(await areas(page), ['O1', 'R', 'O4', 'O3']);
    await page.evaluate(() => window.publish(window.fixture.normalized));
    await expectOrder(page, ['O1', 'O4', 'O3', 'R']);
    assert.deepEqual(await page.locator('tr[data-employee-id]').evaluateAll(rows => rows.map(r => r.dataset.employeeId)), ['P0002', 'P0001', 'N9001', 'B9001', 'P0004', 'P0003']);
    assert.ok((await page.locator('tr[data-area-code="O3"]').innerText()).includes('O3自訂名稱'));
    assert.equal(await page.locator('tr[data-employee-id="X9001"]').count(), 0);
    assert.equal(await page.locator('tr[data-employee-id="B9001"] .cell-rest').count(), 0);
    await expectNewHire(page, 'N9001');
    await page.screenshot({ path: path.join(reportDir, 'front-day-1920.png') });
    await page.getByRole('button', { name: '夜班', exact: true }).click();
    await expectOrder(page, ['O1', 'O4', 'O3', 'S']);
    assert.deepEqual(await page.locator('tr[data-employee-id]').evaluateAll(rows => rows.map(r => r.dataset.employeeId)), ['P1002', 'P1001', 'N9002', 'P1004', 'P1003']);
    await expectNewHire(page, 'N9002');
    await page.screenshot({ path: path.join(reportDir, 'front-night-1920.png') });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
void test('admin live order repair includes empty O sections and preserves custom titles and per-section employee order', async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => window.admin());
    await page.locator('.admin-schedule').waitFor();
    await page.evaluate(() => window.publish(window.fixture.normalized));
    await expectOrder(page, ['O1', 'O4', 'O3', 'O2', 'R']);
    assert.deepEqual(await page.locator('tr[data-employee-id]').evaluateAll(rows => rows.map(r => r.dataset.employeeId)), ['P0002', 'P0001', 'N9001', 'B9001', 'P0004', 'P0003']);
    await expectNewHire(page, 'N9001');
    await page.screenshot({ path: path.join(reportDir, 'admin-day-1920.png') });
    await page.getByRole('button', { name: '大小夜班', exact: true }).click();
    await expectOrder(page, ['O1', 'O4', 'O3', 'O2', 'S']);
    await expectNewHire(page, 'N9002');
    assert.ok((await page.locator('tr[data-area-code="O3"]').innerText()).includes('O3自訂名稱'));
    await page.screenshot({ path: path.join(reportDir, 'admin-night-1920.png') });
    await page.locator('input[placeholder="員編或姓名"]').fill('N9002');
    await expectOrder(page, ['O4']);
    assert.equal(await page.locator('tr[data-employee-id]').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
void test('mobile O navigation lands at the first O section after the repaired layout arrives', async () => {
  const { page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.evaluate(() => window.publish(window.fixture.normalized));
    await expectOrder(page, ['O1', 'O4', 'O3', 'R']);
    await expectNewHire(page, 'N9001');
    await page.locator('.area-jump-dropdown summary').click();
    assert.equal(await page.getByRole('button', { name: 'O', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'O', exact: true }).click();
    assert.equal(await page.locator('.area-jump-dropdown[open]').count(), 0);
    await page.screenshot({ path: path.join(reportDir, 'front-day-mobile.png') });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
