import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

const reportDir = path.join(os.tmpdir(), 'dispatch-ui-round-20260912')
mkdirSync(reportDir, { recursive: true })
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const appSource = readFileSync('app/page.tsx', 'utf8')
const scheduleSource = appSource.slice(appSource.indexOf('function ScheduleView('), appSource.indexOf('function EmptyNotice('))
const dispatchSource = appSource.slice(appSource.indexOf('function DispatchBlockPeople('), appSource.indexOf('const formatBlockPeople'))
const people = Array.from({ length: 24 }, (_, index) => ({ rowId: `row-${index}`, employeeId: `T${String(index).padStart(4, '0')}`,
  name: `測試人員${index + 1}`, title: '調度專員', group: 'day', area: 'D1', shifts: Array(30).fill('早D1') }))
const scheduleData = { month: '2026-09', days: Array.from({ length: 30 }, (_, i) => String(i + 1)), morning: people, night: people,
  layout: { monthKey: '2026-09', rows: people.flatMap(person => ['day', 'night'].map(group => ({ employeeId: person.employeeId, group, section: 'D1區', sectionKey: 'd1', areaCode: 'D1', blankDays: [] }))),
    sections: ['day', 'night'].map(group => ({ key: 'd1', group, section: 'D1區', areaCode: 'D1', label: '萬華 D1區' })) } }
const block = (index = 0) => ({ id: `car-${index}`, blockId: `car-${index}`, date, shiftType: 'day', areaCode: 'O1', areaName: '藝文 O1區',
  vehicleNo: `CAR-${index}`, vehicleType: '', variantCode: 'standard', drivers: [], stations: [], assistants: [], workFocus: '巡查\n回報',
  balanceArea: '', note: '', sourceSheet: 'test', sourceRow: index, status: 'active', modifiedBy: '' })
const schedules = ['早', '晚', '夜'].map((shift, index) => ({ id: `row-${index}`, employeeId: `E${index}`, employeeName: `${shift}班測試員`,
  date, shiftType: 'morning', scheduleCode: `${shift}O1`, title: '調度專員' }))
const fixture = { date, blocks: [block()], schedules, scheduleData }

const entry = `
  import React,{Fragment,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {DispatchShiftBrowser} from '/app/dispatch-shift-browser.tsx';
  import {buildShiftDispatchBlocks} from '/lib/dispatch-schedule-assignment.ts';
  import {pairDispatchCards} from '/lib/dispatch-card-layout.ts';
  import {dispatchShifts,parseDispatchShifts} from '/lib/dispatch-shifts.ts';
  import {dispatchAreaCodes,dispatchAreaDisplay,dispatchBlockFrontOrder} from '/lib/dispatch-area.ts';
  import {monthSections} from '/functions/month-schedule-layout.mjs';
  import {AreaJumpDropdown,scheduleSectionId} from '/app/area-jump-dropdown.tsx';
  import {WorkFocus} from '/app/work-focus.tsx';
  import {Menu,X} from 'lucide-react';
  import '/app/globals.css'; import '/app/matrix.css'; import '/app/area-fix.css';
  import '/app/dispatch.css'; import '/app/youbike-theme.css'; import '/app/mobile-nav.css';
  import '/app/mobile-layout.css'; import '/app/admin-console.css'; import '/app/front-readonly.css';
  const params=new URLSearchParams(location.search);
  if(!params.has('baseline')) await import('/app/schedule-landscape.css');
  const weekdays=['二','三','四','五','六','日','一'];
  const taipeiToday=()=>window.fixture.date;
  const readFrontDispatchCache=()=>null,saveFrontDispatchCache=()=>{},markFrontDispatch=()=>{};
  const listDispatchBlocks=async()=>structuredClone(window.fixture.blocks);
  const listScheduleRecords=async()=>structuredClone(window.fixture.schedules);
  const loadFrontDispatchProfiles=async()=>[],getDocs=async()=>({docs:[]}),collection=()=>({}),db={};
  const listDispatchBlockTemplate=async()=>({blocks:[]}),buildDispatchPreviewBlocks=blocks=>blocks;
  const isLeave=()=>false,monitorDisplayRows=()=>[];
  ${scheduleSource}
  ${dispatchSource}
  function ScheduleShell(){
    const [tab,setTab]=useState('morning'),[open,setOpen]=useState(false);
    return <div className="app-shell" data-page="schedule">
      {open&&<button className="mobile-backdrop" aria-label="關閉選單" onClick={()=>setOpen(false)}/>}
      <aside className={open?'sidebar open':'sidebar'}><div className="logo"><strong>調度工作台</strong><button className="drawer-close" aria-label="關閉側欄" onClick={()=>setOpen(false)}><X/></button></div><nav><button className="nav-item" onClick={()=>setOpen(false)}>我的班表</button></nav></aside>
      <main className="workspace"><header className="topbar"><button className="menu-button" aria-label="開啟選單" onClick={()=>setOpen(true)}><Menu size={22}/></button><div><p className="eyebrow">2026 年 9 月</p><h2>我的班表</h2></div><div className="profile-chip">測試帳號</div></header>
      <section className="content"><ScheduleView tab={tab} setTab={setTab} data={window.fixture.scheduleData} employeeId="T0000"/></section></main>
    </div>
  }
  const screen=params.get('view');
  createRoot(document.getElementById('root')).render(screen==='admin'?<div className="admin-console"><DispatchShiftBrowser/></div>:screen==='dispatch'?<div className="app-shell" data-page="dispatch"><main className="workspace"><section className="content"><FirestoreDispatchView employeeId={params.get('employee')||'observer'} isDuty={!params.has('employee')}/></section></main></div>:<ScheduleShell/>);
`
const mocks = {
  'round:entry': entry,
  'round:blocks': `export const listDispatchBlocks=async()=>structuredClone(window.fixture.blocks);export const listDispatchBlockTemplate=async()=>({blocks:[]});export const buildDispatchPreviewBlocks=(blocks)=>blocks;`,
  'round:schedules': `export async function listScheduleRecords(){if(window.fixture.failSchedule)throw Error('fixture read failure');return structuredClone(window.fixture.schedules);}`,
  'round:firebase': 'export const db={};',
  'round:firestore': `export const collection=(_db,path)=>({path});export async function getDocs(ref){if(ref.path!=='employees')throw Error('Unexpected read');return{docs:[]};}`,
}
const server = await createServer({ configFile: false, logLevel: 'error',
  cacheDir: path.join(reportDir, 'vite-cache'),
  resolve: { alias: { '@': process.cwd() } },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'lucide-react'] },
  plugins: [react(), { name: 'dispatch-ui-round-fixtures', enforce: 'pre',
    resolveId(id, importer) {
      if (id in mocks) return '\0' + id
      if (importer?.replaceAll('\\', '/').endsWith('/app/dispatch-shift-browser.tsx')) {
        const replacement = { '../lib/dispatch-blocks-firestore': 'round:blocks', '../lib/schedule-firestore': 'round:schedules', '../lib/firebase': 'round:firebase', 'firebase/firestore': 'round:firestore' }[id]
        if (replacement) return '\0' + replacement
      }
    },
    async load(id) {
      if (!id.startsWith('\0round:')) return
      const code = mocks[id.slice(1)]
      return id === '\0round:entry' ? (await transformWithEsbuild(code, 'round-entry.tsx', { loader: 'tsx', jsx: 'automatic', target: 'esnext' })).code : code
    },
    configureServer(server) { server.middlewares.use('/round-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/round-test', '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@id/__x00__round:entry"></script>'))
    }) },
  }], server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
after(async () => { await browser.close(); await server.close() })

async function open(view, data = fixture, viewport = { width: 1280, height: 844 }, touch = false) {
  const page = await browser.newPage({ viewport, hasTouch: touch, isMobile: touch })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('fixtureRuntimeError', error.message) })
  page.setDefaultTimeout(8000)
  await page.addInitScript(data => { window.fixture = data }, data)
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/round-test?view=${view}`)
  return { page, errors }
}

test('admin uses shared early/late/night mapping and exposes no write controls', async () => {
  const { page, errors } = await open('admin')
  try {
    await page.locator('.dispatch-table tbody tr').first().waitFor()
    const select = page.getByLabel('班別', { exact: true })
    assert.deepEqual(await select.locator('option').allTextContents(), ['早班', '晚班', '夜班'])
    for (const shift of ['早', '晚', '夜']) {
      await select.selectOption(shift)
      await page.waitForFunction(shift => document.querySelector('.dispatch-table tbody tr')?.getAttribute('data-dispatch-shift') === shift, shift)
      const text = await page.locator('.dispatch-table tbody').innerText()
      assert.ok(text.includes(`${shift}班測試員`))
      for (const other of ['早', '晚', '夜'].filter(value => value !== shift)) assert.ok(!text.includes(`${other}班測試員`))
    }
    assert.equal(await page.getByRole('button', { name: /修改|儲存|帶入|匯入|套用|刪除/ }).count(), 0)
    assert.equal(await page.locator('textarea').count(), 0)
    const source = readFileSync('app/dispatch-shift-browser.tsx', 'utf8')
    assert.ok(!/\b(?:setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction|httpsCallable|saveDispatchConfiguration)\b/.test(source))
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('admin read failures remain inside the readonly dispatch view', async () => {
  const { page, errors } = await open('admin', { ...fixture, failSchedule: true })
  try {
    await page.getByRole('alert').waitFor()
    assert.ok(await page.getByLabel('班別', { exact: true }).isVisible())
    assert.equal(await page.locator('.dispatch-table').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('five vehicles render as 2 + 2 + 1 and second vehicle personal navigation resolves to its paired card', async () => {
  const data = { ...fixture, blocks: Array.from({ length: 5 }, (_, index) => block(index)), schedules: Array.from({ length: 5 }, (_, index) => ({ ...schedules[0], id: `P${index}`, employeeId: `P${index}`, employeeName: `人員${index}` })) }
  const { page, errors } = await open('dispatch', data, { width: 390, height: 844 }, true)
  try {
    await page.locator('.dispatch-card').first().waitFor()
    assert.equal(await page.locator('.dispatch-card').count(), 3)
    const text = await page.locator('.dispatch-grid').innerText()
    assert.ok(text.includes('CAR-0 / CAR-1'))
    assert.ok(text.includes('CAR-2 / CAR-3'))
    assert.equal(await page.locator('.dispatch-card .person').count(), 5)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
  const personal = await open('dispatch&employee=P1', data, { width: 390, height: 844 }, true)
  try {
    await personal.page.waitForFunction(() => document.querySelectorAll('.dispatch-card').length === 3)
    const highlighted = personal.page.locator('.dispatch-card').filter({ has: personal.page.locator('.dispatch-self-person') })
    assert.equal(await highlighted.count(), 1)
    assert.ok((await highlighted.innerText()).includes('CAR-0 / CAR-1'))
    const bounds = await highlighted.boundingBox()
    assert.ok(bounds.y < 844 && bounds.y + bounds.height > 0)
    assert.deepEqual(personal.errors, [])
  } finally { await personal.page.close() }
})

async function measure(page) {
  return page.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    const matrix = document.querySelector('.matrix-wrap').getBoundingClientRect()
    const header = document.querySelector('.schedule-matrix thead').getBoundingClientRect()
    const rows = [...document.querySelectorAll('.schedule-matrix tr[data-employee-id]')].map(row => row.getBoundingClientRect())
    return { topbar: box('.topbar'), tabs: box('.content > .tabs'), matrix: box('.matrix-wrap'),
      rowHeight: rows[0].height, fontSize: getComputedStyle(document.querySelector('.schedule-matrix td')).fontSize,
      fullyVisiblePeople: rows.filter(row => row.top >= Math.max(matrix.top, header.bottom) && row.bottom <= Math.min(matrix.bottom, innerHeight)).length,
      documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
      dense: matchMedia('(orientation: landscape) and (min-width: 480px) and (max-width: 1000px) and (max-height: 500px) and (pointer: coarse)').matches }
  })
}

for (const [width, height, touch] of [[390, 844, true], [844, 390, true], [1280, 844, false]]) {
  test(`schedule layout ${width}x${height}: density, readable rows and working controls`, async () => {
    const { page, errors } = await open('schedule', fixture, { width, height }, touch)
    try {
      await page.locator('[data-employee-id]').first().waitFor()
      const metrics = await measure(page)
      assert.equal(metrics.dense, width === 844)
      assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1)
      if (width === 844) {
        assert.ok(metrics.fullyVisiblePeople >= 7, JSON.stringify(metrics))
        assert.ok(parseFloat(metrics.fontSize) >= 14)
        const controls = await page.locator('.menu-button, .content > .tabs button, .area-jump-dropdown summary').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom } }))
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j]
          assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, 'Controls overlap')
        }
        await page.getByRole('button', { name: '開啟選單', exact: true }).click()
        assert.ok(await page.locator('.sidebar.open').isVisible())
        await page.getByRole('button', { name: '關閉側欄', exact: true }).click()
        assert.equal(await page.locator('.mobile-backdrop').count(), 0)
        await page.locator('.matrix-wrap').evaluate(node => { node.scrollLeft = 400 })
        const aligned = await page.locator('.schedule-matrix').evaluate(table => {
          const header = table.querySelector('thead tr').children, row = table.querySelector('tr[data-employee-id]').children
          return [0, 1, 2].every(index => Math.abs(header[index].getBoundingClientRect().left - row[index].getBoundingClientRect().left) < 1)
        })
        assert.ok(aligned, 'Sticky headers and personnel columns must align')
        await page.locator('.matrix-wrap').evaluate(node => { node.scrollLeft = 0 })
      } else {
        const baseline = await open('schedule&baseline=1', fixture, { width, height }, touch)
        try { await baseline.page.locator('[data-employee-id]').first().waitFor(); assert.deepEqual(metrics, await measure(baseline.page)) }
        finally { await baseline.page.close() }
      }
      await page.screenshot({ path: path.join(reportDir, `schedule-${width}x${height}.png`) })
      console.log('scheduleMetrics', JSON.stringify({ width, height, ...metrics }))
      await page.locator('.area-jump-dropdown summary').click()
      await page.getByRole('button', { name: 'D', exact: true }).click()
      assert.equal(await page.locator('.area-jump-dropdown[open]').count(), 0)
      await page.getByRole('button', { name: '夜班', exact: true }).click()
      assert.equal(await page.locator('tr[data-employee-id]').count(), 24)
      await page.getByRole('button', { name: '我的班表', exact: true }).last().click()
      assert.ok(await page.locator('.personal-month').isVisible())
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}
