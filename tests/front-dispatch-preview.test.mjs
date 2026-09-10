import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { scheduleSections } from '../functions/pre-schedule-order.mjs'

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
      return window.formalByDate?.[date] || (date === '2026-09-09' ? window.fixture.template : []);
    }
    export async function listDispatchBlockTemplate() { window.templateReads++; return { sourceDate: '2026-09-09', blocks: window.fixture.template } }`,
  'test:schedules': `export * from '/lib/schedule-firestore.ts';
    export async function listMonthScheduleRecords() { return window.fixture.monthSchedules }
    export async function listScheduleRecords(date) {
      await new Promise(resolve => setTimeout(resolve, window.delays?.[date] || 0));
      return window.fixture.schedules[date] || [];
    }`,
  'test:functions': `export * from 'firebase/functions';
    export const httpsCallable = (_service, name) => async data => {
      if (name !== 'syncDispatchBlocks') throw new Error('Unexpected callable');
      window.importCalls.push(data);
      window.formalByDate = { ...window.formalByDate, [data.date]: window.fixture.template.map(block => ({...block, date: data.date, modifiedBy: 'manual-import'})) };
      return {data: {date: data.date, dayBlocks: 89, nightBlocks: 94, conflicts: 0}};
    };`,
  'test:entry': `import React from 'react'; import { createRoot } from 'react-dom/client';
    import { FirestoreDispatchView, ScheduleMatrix, ScheduleView, scheduleRecordsToData, DutyStaffPanel, HomeView } from '/app/page.tsx';
    import { ScheduleManager, DutyColumn, DispatchManager, Dashboard } from '/app/admin-console.tsx';
    import '/app/globals.css';
    const root = createRoot(document.getElementById('root'));
    function ScheduleShell({children}) {
      return React.createElement('div', {className:'app-shell', 'data-page':'schedule'},
        React.createElement('aside', {className:'sidebar'}),
        React.createElement('main', {className:'workspace'},
          React.createElement('header', {className:'topbar'}, '班表'),
          React.createElement('section', {className:'content'}, children)));
    }
    window.showDispatch = () => root.render(React.createElement('div', {className: 'app-shell'}, React.createElement(FirestoreDispatchView, {employeeId: 'test', isDuty: false})));
    window.showHome = () => root.render(React.createElement('div', {className: 'app-shell'}, React.createElement(HomeView, {name: '登入人員', onAction: () => {}, onGo: () => {}})));
    window.showFrontDuty = (shift, staff) => root.render(React.createElement(DutyStaffPanel, {shift, staff}));
    window.showManager = () => root.render(React.createElement('div', {className: 'admin-console'}, React.createElement(DispatchManager, {employeeId: 'test'})));
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
  configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'front-readonly-fixture', enforce: 'pre',
    resolveId(id) { if (id in virtual) return '\0' + id + '.tsx' },
    load(id) { if (id.startsWith('\0test:')) return virtual[id.slice(1, -4)] },
    transform(code, id) {
      const admin = id.replaceAll('\\', '/').endsWith('/app/admin-console.tsx')
      if (!admin && !id.replaceAll('\\', '/').endsWith('/app/page.tsx')) return
      return code.replace("from 'firebase/firestore'", "from 'test:firestore'")
        .replace("from 'firebase/functions'", "from 'test:functions'")
        .replace("from '../lib/dispatch-blocks-firestore'", "from 'test:blocks'")
        .replace("from '../lib/schedule-firestore'", "from 'test:schedules'")
        + (admin ? '\nexport { ScheduleManager, DutyColumn, DispatchManager, Dashboard };' : '\nexport { FirestoreDispatchView, ScheduleMatrix, ScheduleView, scheduleRecordsToData, DutyStaffPanel, HomeView };')
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
  window.fixture = data; window.templateReads = 0; window.writeAttempts = 0; window.importCalls = []
  // Initial date is pinned without changing timers or component source.
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:00:00+08:00'])) }
  }
}, fixture)
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/preview-test`)

test('9/9 ordinary saved blocks use schedule people rather than automatic Google people', async () => {
  await page.waitForSelector('.dispatch-card .person')
  assert.equal(await page.locator('.dispatch-card .person').count(), 101)
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
  console.log('府夜21-01 rendered lines', layout.lines)
})

test('admin source-group table scrolls within the viewport and retains pinned header/columns', async () => {
  await page.evaluate(() => window.showAdminSchedule())
  await page.waitForFunction(() => document.querySelectorAll('.admin-schedule tbody tr[data-employee-id]').length === 597)
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
  const codes = await table.locator('tr[data-area-code]').evaluateAll(rows => rows.map(row => row.dataset.areaCode));
  assert.equal(codes.length, new Set(codes).size);
  assert.equal(codes.filter(code => code === 'O1').length, 1);
  await page.locator('.area-jump-dropdown summary').click();
  const panel = page.locator('.area-jump-panel');
  assert.deepEqual(await panel.locator('button').allTextContents(), expected.filter(section => section.areaCode).map(section => section.label));
  const geometry = await panel.evaluate(el => ({height:el.clientHeight, scroll:el.scrollHeight, overflow:getComputedStyle(el).overflowY}));
  assert.ok(geometry.height <= 290 && geometry.scroll > geometry.height);
  assert.equal(geometry.overflow, 'auto');
  await panel.hover();
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('.area-jump-panel').scrollTop > 0);
  await wrap.evaluate(el => {el.scrollLeft = 100});
  const horizontal = await wrap.evaluate(el => el.scrollLeft);
  await panel.getByRole('button', {name:'O1區', exact:true}).click();
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
  await page.waitForFunction(() => document.querySelectorAll('.admin-schedule tr[data-employee-id]').length === 597);
  await assertScheduleNavigation('.admin-schedule', '.admin-schedule-wrap', 'day');
  await page.getByRole('button', {name:'大小夜班',exact:true}).click();
  await assertScheduleNavigation('.admin-schedule', '.admin-schedule-wrap', 'night');
  await page.screenshot({path:'output/schedule-area-jump-admin-1920.png'});
  assert.equal(await page.locator('.admin-schedule td button:not(:disabled)').count(), 0);
  assert.equal(await page.getByLabel('月份', {exact:true}).inputValue(), '2026-09');
  await page.getByPlaceholder('員編或姓名').fill('96504');
  assert.equal(await page.locator('.admin-schedule tr[data-employee-id]').count(), 1);
  await page.locator('.area-jump-dropdown summary').click();
  assert.deepEqual(await page.locator('.area-jump-panel button').allTextContents(), ['O1區']);
  await page.getByPlaceholder('員編或姓名').fill('');
  assert.equal(await page.locator('.admin-schedule tr[data-employee-id]').count(), 153);
  assert.equal(await page.evaluate(() => window.writeAttempts), 0);
  assert.deepEqual(errors, []);
});

test('admin editing still targets the selected employee/date after area navigation; cancel makes no write', async () => {
  await page.evaluate(() => window.showAdminSchedule(true));
  await page.getByPlaceholder('員編或姓名').fill('96504');
  const button = page.locator('.admin-schedule tr[data-employee-id="96504"] td[data-date-column] button').nth(8);
  assert.equal(await button.isEnabled(), true);
  const prompt = page.waitForEvent('dialog');
  const click = button.click();
  const dialog = await prompt;
  assert.equal(dialog.type(), 'prompt');
  assert.match(dialog.message(), /96504 涂佑葦\n2026-09-09 班別/);
  await dialog.dismiss(); await click;
  assert.equal(await page.evaluate(() => window.writeAttempts), 0);
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

test('Dashboard uses the seven operational labels without changing assignment totals', async () => {
  await page.evaluate(() => window.showDashboard())
  await page.waitForFunction(() => document.querySelector('.dispatch-summary .admin-stat strong')?.textContent === '369')
  const labels = await page.locator('.dispatch-summary .admin-stat > span').allTextContents()
  assert.deepEqual(labels, ['日班出勤人數', '夜班出勤人數', '日班出車數', '夜班出車數', '多人共車數', '閒置車輛', '待人工調整人數'])
  assert.deepEqual(await page.locator('.dispatch-summary .admin-stat > strong').allTextContents(), ['369', '101', '89', '94', '58', '53', '0'])
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
  await page.waitForFunction(() => document.querySelectorAll('.dispatch-card .person').length === 109)
  assert.equal(await page.locator('.dispatch-card .person').count(), 109)
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
