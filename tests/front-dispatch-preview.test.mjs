import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

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
  'test:firestore': `export * from 'firebase/firestore';
    export async function getDocs() { return { docs: window.fixture.employees.map(employee => ({ id: employee.employeeId, data: () => employee })) } }`,
  'test:blocks': `export * from '/lib/dispatch-blocks-firestore.ts';
    const denyWrite = () => { window.writeAttempts++; throw new Error('Front preview must remain read-only') };
    export const updateDispatchBlock = denyWrite, writeDispatchBlockAudit = denyWrite, saveDispatchPreviewAsFormal = denyWrite;
    export async function listDispatchBlocks(date) {
      await new Promise(resolve => setTimeout(resolve, window.delays?.[date] || 0));
      return date === '2026-09-09' ? window.fixture.template : [];
    }
    export async function listDispatchBlockTemplate() { window.templateReads++; return { sourceDate: '2026-09-09', blocks: window.fixture.template } }`,
  'test:schedules': `export * from '/lib/schedule-firestore.ts';
    export async function listMonthScheduleRecords() { return window.fixture.monthSchedules }
    export async function listScheduleRecords(date) {
      await new Promise(resolve => setTimeout(resolve, window.delays?.[date] || 0));
      return window.fixture.schedules[date] || [];
    }`,
  'test:entry': `import React from 'react'; import { createRoot } from 'react-dom/client';
    import { FirestoreDispatchView, ScheduleMatrix, DutyStaffPanel } from '/app/page.tsx';
    import { ScheduleManager, DutyColumn } from '/app/admin-console.tsx';
    import '/app/globals.css';
    const root = createRoot(document.getElementById('root'));
    window.showDispatch = () => root.render(React.createElement('div', {className: 'app-shell'}, React.createElement(FirestoreDispatchView, {employeeId: 'test', isDuty: false})));
    window.showSchedule = shift => root.render(React.createElement('div', {className: 'app-shell'}, React.createElement(ScheduleMatrix, {rows: window.fixture.source[shift], days: window.fixture.source.days})));
    window.showAdminSchedule = () => root.render(React.createElement('div', {className: 'admin-console'},
      React.createElement('aside', {className: 'admin-sidebar'}), React.createElement('main', {className: 'admin-main'},
        React.createElement('header', {className: 'admin-topbar'}), React.createElement('section', {className: 'admin-content'}, React.createElement(ScheduleManager, {employeeId: 'test', admin: false})))));
    window.showMonitors = (taipei, newTaipei) => root.render(React.createElement('div', null,
      React.createElement(DutyColumn, {title: '夜班', duty: {directors: [], deputyDirectors: [], taipei, newTaipei}}),
      React.createElement(DutyStaffPanel, {shift: 'night', staff: {directors: [], deputyDirectors: [], taipeiMonitors: taipei, newTaipeiMonitors: newTaipei}})));
    window.showDispatch();`,
}
const server = await createServer({
  configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'front-readonly-fixture', enforce: 'pre',
    resolveId(id) { if (id in virtual) return '\0' + id + '.tsx' },
    load(id) { if (id.startsWith('\0test:')) return virtual[id.slice(1, -4)] },
    transform(code, id) {
      const admin = id.replaceAll('\\', '/').endsWith('/app/admin-console.tsx')
      if (!admin && !id.replaceAll('\\', '/').endsWith('/app/page.tsx')) return
      return code.replace("from 'firebase/firestore'", "from 'test:firestore'")
        .replace("from '../lib/dispatch-blocks-firestore'", "from 'test:blocks'")
        .replace("from '../lib/schedule-firestore'", "from 'test:schedules'")
        + (admin ? '\nexport { ScheduleManager, DutyColumn };' : '\nexport { FirestoreDispatchView, ScheduleMatrix, DutyStaffPanel };')
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
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(data => {
  window.fixture = data; window.templateReads = 0; window.writeAttempts = 0
  // Initial date is pinned without changing timers or component source.
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:00:00+08:00'])) }
  }
}, fixture)
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/preview-test`)

test('9/9 front cards retain formal block people and never request a template', async () => {
  await page.waitForSelector('.dispatch-card .person')
  // The existing employee card intentionally hides the one assistant position.
  const expected = template.filter(block => block.shiftType === 'night').flatMap(block => [...block.drivers, ...block.stations])
  assert.equal(await page.locator('.dispatch-card .person').count(), expected.length)
  assert.equal(expected.length, 109)
  assert.equal(await page.evaluate(() => window.templateReads), 0)
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
  console.log('府夜21-01 rendered lines', layout.lines)
})

test('admin 750-person table scrolls within the viewport and retains pinned header/columns', async () => {
  await page.evaluate(() => window.showAdminSchedule())
  await page.waitForFunction(() => document.querySelectorAll('.admin-schedule tbody tr').length === 750)
  const measure = () => page.locator('.admin-schedule-wrap').evaluate(wrap => {
    const table = wrap.querySelector('table')
    return {
      bottom: wrap.getBoundingClientRect().bottom, height: wrap.clientHeight, scrollHeight: wrap.scrollHeight,
      horizontal: wrap.scrollWidth > wrap.clientWidth, overflowX: getComputedStyle(wrap).overflowX,
      headTop: table.querySelector('thead th:nth-child(4)').getBoundingClientRect().top,
      pinnedLefts: [...table.querySelector('tbody tr').children].slice(0, 3).map(cell => cell.getBoundingClientRect().left),
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
  await page.locator('.admin-schedule-wrap').evaluate(wrap => { wrap.scrollTop = 1000; wrap.scrollLeft = wrap.scrollWidth })
  const after = await measure()
  assert.ok(Math.abs(after.headTop - before.headTop) <= 1)
  assert.deepEqual(after.pinnedLefts, before.pinnedLefts)
  assert.equal(after.bottom, before.bottom)
  console.log('admin viewport scroll', { bottom: before.bottom, height: before.height, columnWidth: before.widths[3] })
})

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
