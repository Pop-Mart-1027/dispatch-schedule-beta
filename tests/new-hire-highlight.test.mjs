import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { isNewHireHighlighted, newHireHighlightTitle } from '../lib/new-hire-highlight.mjs';

const now = '2026-10-02T04:00:00.000Z';
const newHire = { onboardingStartedAt: '2026-10-01T16:00:00.000Z', onboardingHighlightUntil: '2027-01-01T16:00:00.000Z' };
void test('new-hire highlight uses the creation interval and expires at its exclusive end', () => {
  assert.equal(isNewHireHighlighted(newHire, Date.parse(newHire.onboardingStartedAt)), true);
  assert.equal(isNewHireHighlighted(newHire, Date.parse(newHire.onboardingHighlightUntil) - 1), true);
  assert.equal(isNewHireHighlighted(newHire, Date.parse(newHire.onboardingHighlightUntil)), false);
  assert.equal(isNewHireHighlighted(newHire, Date.parse(newHire.onboardingStartedAt) - 1), false);
  for (const profile of [undefined, {}, { hireDate: '2026-10-01' }, { onboardingHighlightUntil: newHire.onboardingHighlightUntil },
    { ...newHire, onboardingStartedAt: 'invalid' }, { ...newHire, onboardingHighlightUntil: 'invalid' },
    { onboardingStartedAt: newHire.onboardingHighlightUntil, onboardingHighlightUntil: newHire.onboardingStartedAt }]) {
    assert.equal(isNewHireHighlighted(profile, Date.parse(now)), false);
  }
  assert.match(newHireHighlightTitle(newHire), /2027\/01\/02/);
});

// Exercise the production schedule functions with isolated data. All external
// requests are blocked, and no Firebase/auth module is loaded by this fixture.
const appSource = readFileSync('app/page.tsx', 'utf8');
const adminSource = readFileSync('app/admin-console.tsx', 'utf8');
const projectionSource = appSource.slice(appSource.indexOf('function scheduleRecordsToData('), appSource.indexOf('async function showEligibleBroadcasts('));
const scheduleSource = appSource.slice(appSource.indexOf('function ScheduleView('), appSource.indexOf('function EmptyNotice('));
const managerSource = adminSource.slice(adminSource.indexOf('function ScheduleManager('), adminSource.indexOf('function AnnouncementManager('));
const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
const people = Array.from({ length: 750 }, (_, i) => ({ employeeId: `P${String(i + 1).padStart(4, '0')}`, name: `既有${i + 1}`, title: '調度專員', group: 'day', area: 'G' }));
people.splice(2, 0, { employeeId: 'N9001', name: '新進小林', title: '調度專員', group: 'day', area: 'G', ...newHire });
people.splice(4, 0, { employeeId: 'N8001', name: '已滿三月', title: '調度專員', group: 'day', area: 'G', onboardingStartedAt: '2026-07-01T04:00:00.000Z', onboardingHighlightUntil: '2026-10-01T04:00:00.000Z' });
const records = people.map(p => ({ id: `${p.employeeId}_2026-10-01`, employeeId: p.employeeId, employeeName: p.name, title: p.title, group: 'day', area: 'G', shiftType: 'morning', date: '2026-10-01', scheduleCode: '休' }));
const layout = { monthKey: '2026-10', revision: 1, rows: people.map(p => ({ employeeId: p.employeeId, group: 'day', section: 'G區', sectionKey: 'g', areaCode: 'G', blankDays: [] })), sections: [{ key: 'g', group: 'day', section: 'G區', areaCode: 'G', label: 'G區' }] };
const fixture = { people, records, layout, days };
const reportDir = path.resolve('output/new-hire-ui');
mkdirSync(reportDir, { recursive: true });
let builtCss;
if (process.env.NEW_HIRE_PAGES_DIR) {
  const html = readFileSync(path.join(process.env.NEW_HIRE_PAGES_DIR, 'index.html'), 'utf8');
  const href = html.match(/href="([^"]+\.css)"/)?.[1];
  assert.ok(href, 'The production build must contain a stylesheet');
  builtCss = readFileSync(path.join(process.env.NEW_HIRE_PAGES_DIR, 'assets', path.basename(href)), 'utf8');
}
const entry = `
  import React,{Fragment,useEffect,useMemo,useRef,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {monthSections,initialMonthRows,monthSectionCatalog} from '/functions/month-schedule-layout.mjs';
  import {scheduleDisplayGroup,preScheduleSource} from '/functions/pre-schedule-order.mjs';
  import sourceSchedule from '/public/september-schedules.json';
  import {AreaJumpDropdown,scheduleSectionId} from '/app/area-jump-dropdown.tsx';
  import {useNewHireClock} from '/app/use-new-hire-clock.ts';
  import {isNewHireHighlighted,newHireHighlightTitle} from '/lib/new-hire-highlight.mjs';
  import {buildScheduleEditCatalog} from '/lib/schedule-edit-catalog.ts';
  import '/app/globals.css'; import '/app/matrix.css'; import '/app/area-fix.css';
  import '/app/youbike-theme.css'; import '/app/mobile-nav.css'; import '/app/mobile-layout.css';
  import '/app/admin-console.css'; import '/app/front-readonly.css'; import '/app/schedule-landscape.css';
  import '/app/new-hire-highlight.css';
  const todayTaipei=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const db={},collection=()=>({}),getDocs=async()=>({docs:window.fixture.people.map(p=>({id:p.employeeId,data:()=>p}))});
  const getMonthLayout=async()=>window.fixture.layout;
  const listMonthScheduleRecords=async()=>window.fixture.records;
  const subscribeMonthSchedule=(_month,callback)=>{queueMicrotask(()=>callback(window.fixture.records,window.fixture.people,window.fixture.layout));return()=>{}};
  const isLeave=code=>/休|例|慰|病|事|假|特/.test(code);
  const ScheduleSheetSyncControls=()=>null,MonthRowManager=()=>null,MonthSectionManager=()=>null,ScheduleCellEditor=()=>null;
  const denyWrite=()=>{throw Error('Unexpected fixture write')};
  const manageMonthRow=denyWrite,updateFormalScheduleCell=denyWrite,getScheduleRecord=denyWrite;
  ${projectionSource}
  ${scheduleSource}
  ${managerSource}
  const root=createRoot(document.getElementById('root'));
  window.project=()=>scheduleRecordsToData(window.fixture.records,window.fixture.people,window.fixture.layout,'2026-10');
  window.projectBlank=()=>scheduleRecordsToData(window.fixture.records.filter(r=>r.employeeId!=='N9001'),window.fixture.people,window.fixture.layout,'2026-10');
  function Front({tab='morning',month='2026-10'}){
    const [selected,setTab]=useState(tab), data=window.project(); data.month=month;
    return <div className="app-shell" data-page="schedule"><aside className="sidebar"/><main className="workspace"><header className="topbar">我的班表</header><section className="content"><ScheduleView tab={selected} setTab={setTab} data={data} employeeId="N9001"/></section></main></div>;
  }
  let key=0;
  window.front=(tab,month)=>root.render(<Front key={key++} tab={tab} month={month}/>);
  window.admin=()=>root.render(<div className="admin-console"><aside className="admin-sidebar"/><main className="admin-main"><header className="admin-topbar">班表管理</header><section className="admin-content"><ScheduleManager key={key++} employeeId="fixture" admin={true}/></section></main></div>);
  window.leave=()=>root.render(<p>其他頁面</p>);
  window.front();
`;
const server = await createServer({ configFile: false, logLevel: 'error', cacheDir: path.join(reportDir, 'vite-cache'),
  resolve: { alias: { '@': process.cwd() } }, optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'lucide-react'] },
  plugins: [react(), { name: 'new-hire-fixture', enforce: 'pre',
    resolveId: id => id === 'new-hire:entry' ? '\0new-hire:entry' : undefined,
    async load(id) { if (id === '\0new-hire:entry') return (await transformWithEsbuild(entry, 'new-hire-entry.tsx', { loader: 'tsx', jsx: 'automatic', target: 'esnext' })).code; },
    configureServer(server) { server.middlewares.use('/new-hire-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/new-hire-test', '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@id/__x00__new-hire:entry"></script>'));
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
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(fixture => {
    window.fixture = fixture; window.scheduleTimers = new Set();
    const start = window.setInterval.bind(window), stop = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => { const id = start(callback, delay, ...args); if (delay === 60000) window.scheduleTimers.add(id); return id; };
    window.clearInterval = id => { window.scheduleTimers.delete(id); stop(id); };
  }, fixture);
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/new-hire-test`);
  await page.locator('tr[data-employee-id="N9001"]').waitFor();
  if (builtCss) await page.evaluate(css => {
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => node.remove());
    const style = document.createElement('style');
    style.textContent = css;
    style.dataset.productionCascade = 'true';
    document.head.appendChild(style);
  }, builtCss);
  return { page, errors };
}
async function colourCells(page, selector) {
  return page.locator(selector).evaluate(row => [...row.children].slice(0, 5).map(td => getComputedStyle(td).backgroundColor));
}

void test('front/admin mark only new-hire identity cells and preserve G section, shifts and all 750 existing employees', async () => {
  const { page, errors } = await open();
  try {
    const projected = await page.evaluate(() => window.project().morning.map(p => ({ id: p.employeeId, until: p.onboardingHighlightUntil })));
    assert.equal(projected.length, 752);
    assert.deepEqual(projected.map(p => p.id), people.map(p => p.employeeId));
    assert.equal(projected.find(p => p.id === 'N9001').until, newHire.onboardingHighlightUntil);
    const blank = await page.evaluate(() => window.projectBlank().morning.find(p => p.employeeId === 'N9001'));
    assert.equal(blank.onboardingHighlightUntil, newHire.onboardingHighlightUntil);
    assert.ok(blank.shifts.every(code => code === ''));
    assert.equal(await page.locator('tr[data-new-hire="true"]').count(), 1);
    assert.ok((await page.locator('tr[data-employee-id="N9001"]').innerText()).includes('新進'));
    const front = await colourCells(page, 'tr[data-employee-id="N9001"]');
    assert.deepEqual(front.slice(1, 3), ['rgb(255, 243, 107)', 'rgb(255, 243, 107)']);
    assert.notEqual(front[0], front[1]); assert.notEqual(front[3], front[1]);
    assert.equal(await page.locator('tr[data-employee-id="N9001"] .cell-rest').count(), 1);
    await page.screenshot({ path: path.join(reportDir, 'front-1920.png') });
    await page.evaluate(() => window.admin());
    await page.locator('.admin-schedule tr[data-employee-id="N9001"]').waitFor();
    assert.deepEqual(await page.locator('tr[data-employee-id]').evaluateAll(rows => rows.map(r => r.dataset.employeeId)), people.map(p => p.employeeId));
    assert.equal(await page.locator('tr[data-new-hire="true"]').count(), 1);
    const admin = await colourCells(page, 'tr[data-employee-id="N9001"]');
    assert.deepEqual(admin.slice(1, 3), front.slice(1, 3));
    assert.notEqual(admin[0], admin[1]); assert.notEqual(admin[3], admin[1]);
    assert.equal(await page.locator('tr[data-employee-id="N9001"] .leave-cell').count(), 1);
    await page.screenshot({ path: path.join(reportDir, 'admin-1920.png') });
    // The selected month must not decide whether a hire is still new.
    await page.getByLabel('月份', { exact: true }).fill('2027-02');
    assert.equal(await page.locator('tr[data-new-hire="true"]').count(), 1);
    await page.clock.setSystemTime(new Date(newHire.onboardingHighlightUntil));
    await page.clock.fastForward(60000);
    assert.equal(await page.locator('tr[data-new-hire="true"]').count(), 0);
    assert.equal(await page.locator('tr[data-employee-id="N9001"] .new-hire-badge').count(), 0);
    await page.evaluate(() => window.leave());
    await page.getByText('其他頁面', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.scheduleTimers.size), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

void test('front and personal schedule restore normally in an open tab, including an older selected month', async () => {
  const { page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.screenshot({ path: path.join(reportDir, 'front-mobile.png') });
    await page.evaluate(() => window.front('mine', '2026-09'));
    await page.locator('.personal-schedule-person[data-new-hire="true"]').waitFor();
    assert.equal(await page.locator('.personal-schedule-person .new-hire-badge').count(), 1);
    assert.equal(await page.locator('.month-day.cell-rest').count(), 1);
    await page.screenshot({ path: path.join(reportDir, 'personal-mobile.png') });
    await page.clock.setSystemTime(new Date(newHire.onboardingHighlightUntil));
    // Focus also updates a tab that the browser may have suspended.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => !document.querySelector('.personal-schedule-person[data-new-hire="true"]'));
    assert.equal(await page.locator('.personal-schedule-person .new-hire-badge').count(), 0);
    await page.evaluate(() => window.front('morning', '2026-09'));
    await page.locator('tr[data-employee-id="N9001"]').waitFor();
    assert.equal(await page.locator('tr[data-new-hire="true"]').count(), 0);
    await page.evaluate(() => window.leave());
    await page.getByText('其他頁面', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.scheduleTimers.size), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
