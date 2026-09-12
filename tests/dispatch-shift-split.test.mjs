import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Run the real pure TypeScript modules without Firebase or production reads.
const modules = new Map()
function loadTs(filename) {
  filename = path.resolve(filename)
  if (modules.has(filename)) return modules.get(filename).exports
  const module = { exports: {} }
  modules.set(filename, module)
  const nativeRequire = createRequire(filename)
  const require = specifier => {
    const target = path.resolve(path.dirname(filename), specifier + '.ts')
    return specifier.startsWith('.') && existsSync(target) ? loadTs(target) : nativeRequire(specifier)
  }
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(require, module, module.exports)
  return module.exports
}

const { parseDispatchShifts, dispatchShifts } = loadTs('lib/dispatch-shifts.ts')
const { buildShiftDispatchBlocks, mergeShiftDispatchCards, parseScheduleAssignments, assignSchedulesToDispatchBlocks } = loadTs('lib/dispatch-schedule-assignment.ts')
const date = '2026-09-05'
const record = (employeeId, scheduleCode, extra = {}) => ({
  id: employeeId, date, employeeId, employeeName: employeeId, scheduleCode,
  shiftType: 'morning', title: '駕駛', ...extra,
})
const block = (extra = {}) => ({
  id: 'd1', blockId: 'd1', date, shiftType: 'day', areaCode: 'D1', areaName: '萬華 D1區',
  variantCode: 'standard', vehicleNo: 'TEST-01', vehicleType: '', drivers: [], stations: [], assistants: [],
  workFocus: 'existing work', balanceArea: '', note: '', sourceRow: 1, sourceSheet: 'fixture',
  status: 'active', modifiedBy: '', ...extra,
})
const project = (schedules, blocks = [block()]) => buildShiftDispatchBlocks({ date, schedules, blocks, employees: [] })
const ids = (blocks, shift) => blocks.filter(b => b.dispatchShift === shift)
  .flatMap(b => [...b.drivers, ...b.stations, ...b.assistants].map(p => p.employeeId)).sort()

for (const [code, expected] of [
  ['早O1', ['早']], ['晚O1', ['晚']], ['夜O1', ['夜']],
  ['O1早08-12 / O1晚16-20', ['早', '晚']], ['晚夜', ['晚', '夜']], ['小夜', ['晚', '夜']],
  ['休', []], ['例', []], ['國假', []], ['請假類', []], ['早班請假', []],
  ['', []], [undefined, []], ['O1', []], ['早O1 / 晚請假', ['早']],
]) test(`daily shift parser: ${String(code)}`, () => assert.deepEqual(parseDispatchShifts(code), expected))

test('D1: 5 morning / 3 evening / 4 night, no combined 12-person card', () => {
  const schedules = dispatchShifts.flatMap((shift, index) => Array.from({ length: [5, 3, 4][index] }, (_, n) => record(`${shift}${n}`, `${shift}D1`)))
  const result = project(schedules)
  for (const [index, shift] of dispatchShifts.entries()) {
    assert.equal(ids(result, shift).length, [5, 3, 4][index])
    assert.ok(ids(result, shift).every(id => id.startsWith(shift)))
    assert.equal(result.filter(b => b.dispatchShift === shift && b.areaCode === 'D1').length, 1)
  }
})

test('daily content overrides roster source, employee title and fixed properties', () => {
  const result = buildShiftDispatchBlocks({ date,
    blocks: [block({ shiftType: 'night' })], schedules: [record('96504', '早D1', { shiftType: 'night' })],
    employees: [{ employeeId: '96504', name: 'same name', title: 'PT-夜班' }],
  })
  assert.deepEqual(ids(result, '早'), ['96504'])
  assert.deepEqual(ids(result, '晚'), [])
  assert.deepEqual(ids(result, '夜'), [])
})

test('two shifts in one cell appear in both tabs with independent area assignments', () => {
  const result = project([record('dual', 'D1早08-12 / O1晚16-20')], [block(), block({ id: 'o1', blockId: 'o1', areaCode: 'O1', areaName: '藝文 O1區' })])
  assert.deepEqual(ids(result, '早'), ['dual'])
  assert.deepEqual(ids(result, '晚'), ['dual'])
  assert.deepEqual(ids(result, '夜'), [])
  assert.deepEqual(result.filter(b => b.drivers.length).map(b => [b.dispatchShift, b.areaCode]), [['早', 'D1'], ['晚', 'O1']])
})

for (const code of ['D1晚夜17-01', 'D1小夜', '晚夜D1', '小夜D1']) test(`${code}: evening and night, not morning`, () => {
  const result = project([record('dual', code)])
  assert.deepEqual(ids(result, '早'), [])
  assert.deepEqual(ids(result, '晚'), ['dual'])
  assert.deepEqual(ids(result, '夜'), ['dual'])
})

test('manual drivers/stations/assistants require the same-date schedule and employeeId', () => {
  const person = employeeId => ({ employeeId, employeeName: 'identical name' })
  const manual = block({ modifiedBy: 'admin', drivers: [person('early'), person('late'), person('off')],
    stations: [person('night')], assistants: [person('missing'), person('other-date')] })
  const result = project([record('early', '早'), record('late', '晚'), record('night', '夜'),
    record('off', '休'), record('other-date', '早', { date: '2026-09-06' })], [manual])
  assert.deepEqual(ids(result, '早'), ['early'])
  assert.deepEqual(ids(result, '晚'), ['late'])
  assert.deepEqual(ids(result, '夜'), ['night'])
})

test('bare daily periods preserve existing imported placement without using employee attributes', () => {
  const imported = block({ drivers: [
    { employeeId: 'early', employeeName: 'early' },
    { employeeId: 'dual', employeeName: 'dual' },
    { employeeId: 'off', employeeName: 'off' },
    { employeeId: 'missing', employeeName: 'missing' },
  ] })
  const result = project([record('early', '早'), record('dual', '晚夜'), record('off', '例')], [imported])
  assert.deepEqual(ids(result, '早'), ['early'])
  assert.deepEqual(ids(result, '晚'), ['dual'])
  assert.deepEqual(ids(result, '夜'), ['dual'])
  assert.equal(imported.drivers.length, 4)
})

test('source records, manual arrays, and vehicle/work fields are not mutated', () => {
  const input = { schedules: [record('dual', 'D1晚夜')], blocks: [block()] }
  const before = structuredClone(input)
  const result = project(input.schedules, input.blocks)
  assert.deepEqual(input, before)
  for (const b of result) {
    assert.equal(b.vehicleNo, 'TEST-01')
    assert.equal(b.workFocus, 'existing work')
    assert.equal(b.shiftType, 'day')
  }
})

test('duplicate source records dedupe by employee/date/shift, different dates excluded', () => {
  const result = project([record('one', '早D1'), record('one', '早D1'),
    record('one', '早D1', { shiftType: 'night' }), record('tomorrow', '早D1', { date: '2026-09-06' })],
  [block(), block({ id: 'night-d1', blockId: 'night-d1', shiftType: 'night' })])
  assert.deepEqual(ids(result, '早'), ['one'])
})

test('future preview uses only selected-date schedules; missing schedules show no people', () => {
  const preview = block({ status: 'preview' })
  assert.deepEqual(ids(project([record('preview', '晚D1')], [preview]), '晚'), ['preview'])
  const manual = block({ modifiedBy: 'admin', drivers: [{ employeeId: 'old', employeeName: 'old' }] })
  for (const shift of dispatchShifts) assert.deepEqual(ids(project([], [manual]), shift), [])
})

test('existing two-roster callers retain their previous behavior', () => {
  assert.deepEqual(parseScheduleAssignments('O1晚夜17-01', ['O1'], 'day').map(p => p.shift), ['day', 'night'])
  const result = assignSchedulesToDispatchBlocks({ blocks: [block()], schedules: [record('legacy', 'D1')], employees: [], shift: 'day' })
  assert.equal(result.blocks[0].drivers[0].employeeId, 'legacy')
})

const o1Block = (extra = {}) => block({ areaCode: 'O1', areaName: '藝文 O1區', vehicleNo: 'RFW-7651', ...extra })
const shiftCard = (extra = {}) => ({ ...o1Block(), dispatchShift: '早', assignmentStatus: 'normal', ...extra })
const person = employeeId => ({ employeeId, employeeName: employeeId })

test('O1 / RFW-7651: day and night templates produce one populated card, not a second empty card', () => {
  const result = project([record('driver', '早O1'), record('station', '早O1', { title: 'PT-駐點' })], [
    o1Block({ id: 'day-template' }), o1Block({ id: 'night-template', shiftType: 'night' }),
  ]).filter(card => card.dispatchShift === '早')
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].drivers.map(p => p.employeeId), ['driver'])
  assert.deepEqual(result[0].stations.map(p => p.employeeId), ['station'])
})

test('populated duplicates merge roles by employeeId and retain distinct work focus once', () => {
  const input = [
    shiftCard({ id: 'first', drivers: [person('a')], stations: [person('b')], workFocus: '巡查\n回報' }),
    shiftCard({ id: 'second', drivers: [person('a'), person('c')], stations: [person('b')], assistants: [person('d')], workFocus: ' 回報 \n補車', note: 'extra note' }),
    shiftCard({ id: 'empty-template', workFocus: '巡查' }),
  ]
  const before = structuredClone(input)
  const cards = mergeShiftDispatchCards(input)
  assert.equal(cards.length, 1)
  assert.deepEqual(cards[0].drivers.map(p => p.employeeId), ['a', 'c'])
  assert.deepEqual(cards[0].stations.map(p => p.employeeId), ['b'])
  assert.deepEqual(cards[0].assistants.map(p => p.employeeId), ['d'])
  assert.equal(cards[0].workFocus, '巡查\n回報\n補車')
  assert.equal(cards[0].note, 'extra note')
  assert.deepEqual(input, before)
})

test('same area, different vehicles remain separate', () => {
  assert.equal(mergeShiftDispatchCards([shiftCard(), shiftCard({ id: 'other', vehicleNo: 'RFW-9999' })]).length, 2)
})

test('same vehicle remains separate across shifts, areas and dates', () => {
  const cards = mergeShiftDispatchCards([
    shiftCard(), shiftCard({ id: 'late', dispatchShift: '晚' }), shiftCard({ id: 'night', dispatchShift: '夜' }),
    shiftCard({ id: 'other-area', areaCode: 'D1', areaName: '萬華 D1區' }),
    shiftCard({ id: 'tomorrow', date: '2026-09-06' }),
  ])
  assert.equal(cards.length, 5)
})

test('display-area aliases and vehicle whitespace/case normalize to one key', () => {
  const cards = mergeShiftDispatchCards([
    shiftCard({ id: 'empty', areaCode: 'ZO1', areaName: '藝文 ZO1區', vehicleNo: ' rfw-7651 ' }),
    shiftCard({ id: 'staffed', drivers: [person('a')] }),
  ])
  assert.equal(cards.length, 1)
  assert.equal(cards[0].areaCode, 'O1')
  assert.deepEqual(cards[0].drivers.map(p => p.employeeId), ['a'])
})

test('two populated source rosters retain both people after card merge', () => {
  const cards = project([record('day-driver', '早O1'), record('night-driver', '早O1', { shiftType: 'night' })], [
    o1Block({ id: 'day-template' }), o1Block({ id: 'night-template', shiftType: 'night' }),
  ]).filter(card => card.dispatchShift === '早')
  assert.equal(cards.length, 1)
  assert.deepEqual(cards[0].drivers.map(p => p.employeeId).sort(), ['day-driver', 'night-driver'])
})

test('duplicate empty templates collapse to one card instead of removing the unique template', () => {
  const cards = mergeShiftDispatchCards([shiftCard(), shiftCard({ id: 'empty-duplicate' })])
  assert.equal(cards.length, 1)
  assert.equal(cards[0].drivers.length, 0)
})

test('actual dispatch view switches 5 / 3 / 4 people, including mobile and multiple-shift cells', async () => {
  const { createServer, transformWithEsbuild } = await import('vite')
  const { chromium } = await import('playwright')
  // Compile the actual view and its person/duty renderers. Only I/O and the
  // unrelated jump/work-focus controls are fixtures; grouping is production code.
  const source = readFileSync('app/page.tsx', 'utf8')
  const view = source.slice(source.indexOf('function DispatchBlockPeople('), source.indexOf('const formatBlockPeople'))
  const fixtureSchedules = dispatchShifts.flatMap((shift, index) => Array.from({ length: [5, 3, 4][index] }, (_, n) => record(`${shift}${n}`, `${shift}D1`)))
  const virtual = `
    import React, {Fragment,useState,useEffect,useMemo,useRef,useLayoutEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {buildShiftDispatchBlocks} from '/lib/dispatch-schedule-assignment.ts';
    import {dispatchShifts,parseDispatchShifts} from '/lib/dispatch-shifts.ts';
    import {dispatchAreaCodes,dispatchAreaDisplay,dispatchBlockFrontOrder} from '/lib/dispatch-area.ts';
    const fixture=window.fixture;
    const taipeiToday=()=> '${date}';
    const readFrontDispatchCache=()=>null,saveFrontDispatchCache=()=>{},markFrontDispatch=()=>{};
    const listDispatchBlocks=async()=>structuredClone(fixture.blocks);
    const listScheduleRecords=async()=>structuredClone(fixture.schedules);
    const loadFrontDispatchProfiles=async()=>[];
    const listDispatchBlockTemplate=async()=>({blocks:[]});
    const buildDispatchPreviewBlocks=(blocks)=>blocks;
    const db={},collection=()=>({}),getDocs=async()=>({docs:[]});
    const isLeave=()=>false,monitorDisplayRows=()=>[];
    const scheduleSectionId=(...parts)=>parts.join('-');
    const AreaJumpDropdown=()=>null;
    const WorkFocus=({text})=><span>{text}</span>;
    ${view}
    createRoot(document.getElementById('root')).render(<FirestoreDispatchView employeeId="observer" isDuty={true}/>);
  `
  const server = await createServer({ configFile: false, logLevel: 'error',
    resolve: { alias: { '@': process.cwd() } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    plugins: [{ name: 'dispatch-shift-view-fixture',
      resolveId(id) { if (id === 'shift-view-fixture') return '\0shift-view-fixture' },
      async load(id) { if (id === '\0shift-view-fixture') return (await transformWithEsbuild(virtual, 'shift-view.tsx', { loader: 'tsx', jsx: 'automatic' })).code },
      configureServer(server) { server.middlewares.use('/shift-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/shift-test', '<div id="root"></div><script type="module" src="/@id/__x00__shift-view-fixture"></script>'))
      }) },
    }], server: { host: '127.0.0.1', port: 0 },
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(fixture => { window.fixture = fixture }, { schedules: fixtureSchedules,
        blocks: [block(), block({ id: 'duplicate-night-template', blockId: 'duplicate-night-template', shiftType: 'night' })] })
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/shift-test`)
      await page.locator('.dispatch-card .person').first().waitFor()
      assert.deepEqual(await page.locator('.dispatch-toolbar .tabs button').allTextContents(), ['早班', '晚班', '夜班'])
      for (const [shift, count] of [['早', 5], ['晚', 3], ['夜', 4], ['早', 5]]) {
        await page.getByRole('button', { name: `${shift}班`, exact: true }).click()
        assert.equal(await page.locator('.dispatch-card .person').count(), count)
        assert.equal(await page.locator('.dispatch-card').count(), 1)
        assert.ok((await page.locator('.dispatch-card .person small').allTextContents()).every(id => id.startsWith(shift)))
      }
      await page.evaluate(() => { sessionStorage.clear() })
      await page.addInitScript(({ date }) => {
        window.fixture = { ...window.fixture, schedules: [{ date, id: 'dual', employeeId: 'dual', employeeName: 'dual', scheduleCode: 'D1早08-12 / D1晚16-20', shiftType: 'morning' }] }
      }, { date })
      await page.reload()
      await page.locator('.dispatch-card .person').first().waitFor()
      for (const [shift, count] of [['早', 1], ['晚', 1], ['夜', 0]]) {
        await page.getByRole('button', { name: `${shift}班`, exact: true }).click()
        assert.equal(await page.locator('.dispatch-card .person').count(), count)
        assert.equal(await page.locator('.dispatch-card').count(), 1)
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})
