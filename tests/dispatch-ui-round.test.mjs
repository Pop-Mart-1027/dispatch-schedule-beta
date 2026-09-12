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
const viewportMeta = readFileSync('index.html', 'utf8').match(/<meta name="viewport"[^>]+>/)?.[0]
assert.ok(viewportMeta, 'Pages entry must contain a viewport meta tag')

const entry = `
  import React,{Fragment,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {installAppViewport} from '/lib/app-viewport.ts';
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
  if(params.has('viewport')) installAppViewport();
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
  createRoot(document.getElementById('root')).render(screen==='admin'?<div className="admin-console"><DispatchShiftBrowser/></div>:screen==='dispatch'?<div className="app-shell" data-page="dispatch"><main className="workspace">{params.has('viewport')&&<header className="topbar"><button className="menu-button" aria-label="開啟選單"><Menu/></button><h2>派工單</h2></header>}<section className="content"><FirestoreDispatchView employeeId={params.get('employee')||'observer'} isDuty={!params.has('employee')}/></section></main></div>:<ScheduleShell/>);
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
      res.end(await server.transformIndexHtml('/round-test', viewportMeta + '<div id="root"></div><script type="module" src="/@id/__x00__round:entry"></script>'))
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

// Exercise the actual Pages build cascade, not only Vite's fixture import order.
// Run npm run build:pages before this suite; assets are read locally, never from production.
function productionCss() {
  const outputDir = process.env.SCHEDULE_PAGES_DIR || 'gh-pages'
  const html = readFileSync(path.join(outputDir, 'index.html'), 'utf8')
  const href = html.match(/href="([^"]+\.css)"/)?.[1]
  assert.ok(href, 'Run npm run build:pages before the UI suite')
  return readFileSync(path.join(outputDir, 'assets', path.basename(href)), 'utf8')
}

async function applyBuiltCss(page, css) {
  await page.locator('[data-employee-id], .dispatch-card, .dispatch-table tbody tr').first().waitFor()
  await page.evaluate(css => {
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => node.remove())
    const style = document.createElement('style')
    style.dataset.productionCascade = 'true'
    style.textContent = css
    document.head.appendChild(style)
  }, css)
}

async function assertDenseProduction(page, width, height, safe = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const metrics = await measure(page)
  assert.equal(metrics.dense, true)
  assert.ok(Math.abs(metrics.matrix.y - (40 + safe.top)) <= 1, JSON.stringify(metrics))
  assert.ok(Math.abs(metrics.matrix.y + metrics.matrix.height - (height - Math.max(4, safe.bottom))) <= 1, JSON.stringify(metrics))
  assert.ok(Math.abs(metrics.matrix.width - (width - 16)) <= 1, JSON.stringify(metrics))
  assert.ok(metrics.fullyVisiblePeople >= 7, JSON.stringify(metrics))
  assert.equal(metrics.rowHeight, 30)
  const controls = await page.locator('.menu-button, .content > .tabs button, .area-jump-dropdown summary').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }))
  for (const r of controls) assert.ok(r.left >= safe.left && r.top >= safe.top && r.right <= width - safe.right && r.bottom <= 40 + safe.top, JSON.stringify(controls))
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j]
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'Production controls overlap')
  }
  for (const scrollLeft of [0, 400, 1400]) {
    await page.locator('.matrix-wrap').evaluate((node, left) => { node.scrollLeft = left }, scrollLeft)
    const aligned = await page.locator('.schedule-matrix').evaluate(table => {
      const header = table.querySelector('thead tr').children
      const row = table.querySelector('tr[data-employee-id]').children
      return [0, 1, 2].every(index => {
        const h = header[index].getBoundingClientRect(), r = row[index].getBoundingClientRect()
        return Math.abs(h.left - r.left) < 1 && Math.abs(h.width - r.width) < 1
          && getComputedStyle(row[index]).position === 'sticky'
      })
    })
    assert.ok(aligned, `Production sticky columns misalign at scrollLeft=${scrollLeft}`)
  }
  await page.locator('.matrix-wrap').evaluate(node => { node.scrollLeft = 0 })
  return metrics
}

for (const [width, height] of [[844, 390], [740, 390], [667, 375]]) {
  test(`Pages built CSS ${width}x${height}: full-height, aligned controls and sticky columns`, async () => {
    const { page, errors } = await open('schedule', fixture, { width, height }, true)
    try {
      await applyBuiltCss(page, productionCss())
      const metrics = await assertDenseProduction(page, width, height)
      await page.getByRole('button', { name: '開啟選單', exact: true }).click()
      await page.getByRole('button', { name: '關閉側欄', exact: true }).click()
      await page.locator('.area-jump-dropdown summary').click()
      await page.getByRole('button', { name: 'D', exact: true }).click()
      await page.getByRole('button', { name: '夜班', exact: true }).click()
      await assertDenseProduction(page, width, height)
      await page.getByRole('button', { name: '早班', exact: true }).click()
      await assertDenseProduction(page, width, height)
      await page.screenshot({ path: path.join(reportDir, `production-schedule-${width}x${height}.png`) })
      console.log('productionScheduleMetrics', JSON.stringify({ width, height, ...metrics }))
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

test('Pages built CSS stays full-height through rotation and viewport-height changes', async () => {
  const { page, errors } = await open('schedule', fixture, { width: 390, height: 844 }, true)
  try {
    await applyBuiltCss(page, productionCss())
    for (const [width, height] of [[740, 390], [740, 320], [390, 844], [844, 390], [390, 844], [740, 390]]) {
      await page.setViewportSize({ width, height })
      if (width > height) await assertDenseProduction(page, width, height)
      else assert.equal((await measure(page)).dense, false)
    }
    await page.locator('.matrix-wrap').evaluate(node => { node.scrollTop = 300 })
    const painted = await page.evaluate(() => {
      const matrix = document.querySelector('.matrix-wrap').getBoundingClientRect()
      const element = document.elementFromPoint(matrix.left + 250, matrix.top + 100)
      return Boolean(element?.closest('td'))
    })
    assert.ok(painted, 'Schedule scroller must remain visible after rotation and scrolling')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('previous Pages CSS reproduces the narrow-landscape height and sticky-name regression', {
  skip: !process.env.SCHEDULE_BEFORE_CSS,
}, async () => {
  const { page } = await open('schedule', fixture, { width: 740, height: 390 }, true)
  try {
    await applyBuiltCss(page, readFileSync(process.env.SCHEDULE_BEFORE_CSS, 'utf8'))
    const before = await measure(page)
    const nameLeft = await page.locator('.schedule-matrix tr[data-employee-id] > :nth-child(3)').first().evaluate(node => getComputedStyle(node).left)
    console.log('beforeProductionRegression', JSON.stringify({ ...before, nameLeft }))
    assert.ok(before.matrix.height < 390 - 44)
    assert.equal(nameLeft, '0px')
    await applyBuiltCss(page, productionCss())
    await assertDenseProduction(page, 740, 390)
  } finally { await page.close() }
})

for (const [width, height, touch] of [[390, 844, true], [1280, 844, false]]) {
  test(`Pages built CSS ${width}x${height} unchanged outside phone landscape`, {
    skip: !process.env.SCHEDULE_BEFORE_CSS,
  }, async () => {
    const { page } = await open('schedule', fixture, { width, height }, touch)
    try {
      await applyBuiltCss(page, readFileSync(process.env.SCHEDULE_BEFORE_CSS, 'utf8'))
      const before = await measure(page)
      await applyBuiltCss(page, productionCss())
      assert.deepEqual(await measure(page), before)
    } finally { await page.close() }
  })
}

test('Pages entry and built HTML opt into viewport-fit=cover without disabling zoom', () => {
  const html = readFileSync(path.join(process.env.SCHEDULE_PAGES_DIR || 'gh-pages', 'index.html'), 'utf8')
  for (const text of [viewportMeta, html.match(/<meta name="viewport"[^>]+>/)?.[0] || '']) {
    assert.match(text, /viewport-fit=cover/)
    assert.doesNotMatch(text, /user-scalable=no|maximum-scale=1/)
  }
})

async function simulateSafeArea(page, safe) {
  await page.evaluate(safe => {
    for (const [edge, value] of Object.entries(safe)) document.documentElement.style.setProperty(`--screen-safe-${edge}`, `${value}px`)
  }, safe)
}

for (const safe of [{ top: 0, right: 0, bottom: 21, left: 59 }, { top: 0, right: 59, bottom: 21, left: 0 }]) {
  test(`landscape safe-area simulation: left=${safe.left}, right=${safe.right}`, async () => {
    const { page, errors } = await open('schedule', fixture, { width: 844, height: 390 }, true)
    try {
      await applyBuiltCss(page, productionCss())
      await simulateSafeArea(page, safe)
      const metrics = await assertDenseProduction(page, 844, 390, safe)
      const position = await page.evaluate(() => {
        const body = getComputedStyle(document.body)
        const first = document.querySelector('tr[data-employee-id] td')
        const rect = first.getBoundingClientRect()
        return { bodyPadding: body.padding, textLeft: rect.left + parseFloat(getComputedStyle(first).paddingLeft) }
      })
      assert.equal(position.bodyPadding, '0px')
      assert.ok(position.textLeft >= safe.left)
      await page.getByRole('button', { name: '開啟選單', exact: true }).click()
      const sidebar = await page.locator('.sidebar.open').boundingBox()
      assert.ok(sidebar.x >= safe.left && sidebar.y >= safe.top && sidebar.y + sidebar.height <= 390 - safe.bottom + 1)
      await page.getByRole('button', { name: '關閉側欄', exact: true }).click()
      await page.screenshot({ path: path.join(reportDir, `safe-area-landscape-${safe.left}-${safe.right}.png`) })
      console.log('safeAreaMetrics', JSON.stringify({ safe, ...metrics }))
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

for (const view of ['dispatch', 'admin']) {
  test(`${view} retains safe-area bounds without enabling schedule density`, async () => {
    const { page, errors } = await open(view, fixture, { width: 844, height: 390 }, true)
    try {
      await applyBuiltCss(page, productionCss())
      await simulateSafeArea(page, { top: 0, right: 44, bottom: 21, left: 44 })
      const bounds = await page.locator('#root').boundingBox()
      assert.equal(bounds.x, 44)
      assert.equal(bounds.width, 844 - 88)
      assert.equal(await page.locator('.app-shell[data-page="schedule"]').count(), 0)
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

for (const [width, height] of [[390, 844], [844, 390], [320, 568]]) {
  test(`dispatch fixed controls ${width}x${height}: no bleed, one-row shifts and working area jump`, async () => {
    const data = { ...fixture, blocks: Array.from({ length: 8 }, (_, i) => ({ ...block(i), workFocus: Array.from({ length: 45 }, (_, j) => `Long work focus ${j + 1}: inspect and report safely`).join('\n') })) }
    const { page, errors } = await open('dispatch&viewport=1', data, { width, height }, true)
    try {
      await applyBuiltCss(page, productionCss())
      const bounds = async () => page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } }
        return { topbar: rect('.topbar'), toolbar: rect('.dispatch-toolbar'), tabs: rect('.dispatch-toolbar .tabs'), dropdown: rect('.dispatch-toolbar summary'), scroller: rect('.dispatch-scroll-region'), buttons: [...document.querySelectorAll('.dispatch-toolbar .tab')].map(node => { const r = node.getBoundingClientRect(); return { y: r.y, right: r.right, width: r.width } }) }
      })
      const before = await bounds()
      assert.equal(before.buttons.length, 3)
      assert.ok(before.buttons.every(b => b.y === before.buttons[0].y && b.width >= 48))
      assert.ok(Math.abs(before.dropdown.y - before.buttons[0].y) <= 4)
      assert.ok(before.tabs.right <= before.dropdown.x)
      assert.ok(before.dropdown.right <= width)
      assert.ok(before.scroller.y >= before.toolbar.bottom)
      assert.ok(before.scroller.bottom <= height)
      assert.ok(before.toolbar.height <= 106, JSON.stringify(before))
      for (const top of [100, 650, 1400]) {
        await page.locator('.dispatch-scroll-region').evaluate((node, value) => { node.scrollTop = value }, top)
        assert.ok(await page.locator('.dispatch-scroll-region').evaluate(node => node.scrollTop > 0))
        assert.deepEqual(await bounds(), before)
        const painted = await page.evaluate(() => {
          const controls = document.querySelector('.dispatch-toolbar').getBoundingClientRect()
          const topbar = document.querySelector('.topbar').getBoundingClientRect()
          const isCard = (x, y) => Boolean(document.elementFromPoint(x, y)?.closest('.dispatch-card,.duty-staff'))
          return { bleed: [controls.top + 2, controls.bottom - 2, topbar.bottom - 2].some(y => isCard(controls.left + 20, y)), bodyScroll: scrollY,
            background: getComputedStyle(document.querySelector('.dispatch-toolbar')).backgroundColor }
        })
        assert.equal(painted.bleed, false)
        assert.equal(painted.bodyScroll, 0)
        assert.equal(painted.background, 'rgb(244, 246, 247)')
      }
      for (const label of ['晚班', '夜班', '早班']) {
        await page.getByRole('button', { name: label, exact: true }).click()
        assert.ok(await page.getByRole('button', { name: label, exact: true }).evaluate(node => node.classList.contains('active')))
      }
      await page.locator('.area-jump-dropdown summary').click()
      const panel = await page.locator('.area-jump-panel').boundingBox()
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width)
      await page.locator('.area-jump-panel button').first().click()
      assert.equal(await page.locator('.area-jump-dropdown[open]').count(), 0)
      const card = await page.locator('.dispatch-card').first().boundingBox()
      assert.ok(card.y >= before.scroller.y - 1 && card.y < before.scroller.y + 16)
      if (width <= 760) {
        await page.locator('.dispatch-scroll-region').evaluate(node => { node.scrollTop = 700 })
        await page.getByRole('button', { name: '回到頂部', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.dispatch-scroll-region').scrollTop < 2)
      }
      await page.screenshot({ path: path.join(reportDir, `dispatch-controls-${width}x${height}.png`) })
      console.log('dispatchControlMetrics', JSON.stringify({ width, height, ...before }))
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}
