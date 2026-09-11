import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(async () => server.close())

const { employeeAdminOrder, titleAdminOrder } = await server.ssrLoadModule('/lib/admin-employee-order.ts')
const { assignSchedulesToDispatchBlocks, parseScheduleAssignment, parseScheduleAssignments, summarizeDispatchAssignment } = await server.ssrLoadModule('/lib/dispatch-schedule-assignment.ts')
const { buildDispatchPreviewBlocks } = await server.ssrLoadModule('/lib/dispatch-blocks-firestore.ts')

const block = (blockId, areaCode, vehicleNo, variantCode = 'standard') => ({
  id: blockId, blockId, date: '2026-09-02', shiftType: 'night', areaCode, areaName: variantCode === 'small-night' ? `小夜 ${areaCode}` : `${areaCode}區`, variantCode,
  vehicleNo, vehicleType: '', drivers: [], stations: [], assistants: [], workFocus: '', balanceArea: '', note: '', sourceSheet: 'test', sourceRow: 1,
  status: 'active', modifiedBy: '',
})

const schedule = (employeeId, scheduleCode) => ({
  id: `${employeeId}_2026-09-02`, employeeId, employeeName: employeeId, date: '2026-09-02', shiftType: 'night', scheduleCode,
  scheduleLabel: scheduleCode, leaveType: '', source: 'test', status: 'active', note: '', modifiedBy: '',
})

test('backend employee order uses title rank then employeeId', () => {
  const employees = [
    { employeeId: 'B20', title: 'PT-夜' },
    { employeeId: 'B11', title: '調度專員-N' },
    { employeeId: 'B02', title: '調度主任' },
    { employeeId: 'B01', title: '調度主任' },
    { employeeId: 'B03', title: '未分類' },
  ].sort(employeeAdminOrder)
  assert.deepEqual(employees.map(employee => employee.employeeId), ['B01', 'B02', 'B11', 'B20', 'B03'])
})

test('title options keep the required management hierarchy', () => {
  const titles = ['PT-早', '實習生', '調度副主任', '調度主任', '調度專員-E'].sort(titleAdminOrder)
  assert.deepEqual(titles, ['調度主任', '調度副主任', '調度專員-E', 'PT-早', '實習生'])
})

test('daily code resolves cross-day area and duty without fixed employee area', () => {
  assert.deepEqual(parseScheduleAssignment('夜K1', ['K1', 'O4']), { kind: 'area', areaCode: 'K1', variant: 'standard' })
  assert.deepEqual(parseScheduleAssignment('夜O4', ['K1', 'O4']), { kind: 'area', areaCode: 'O4', variant: 'standard' })
  assert.equal(parseScheduleAssignment('夜監', ['K1', 'O4']).kind, 'duty')

  const source = JSON.parse(readFileSync('public/september-schedules.json', 'utf8'))
  const employee = source.night.find(row => row.name === '曾芳英')
  assert.deepEqual(employee.shifts.slice(6, 10), ['夜K1', '夜O4', '夜O4', '夜監'])
  assert.equal(parseScheduleAssignment(employee.shifts[6], ['K1', 'O4']).areaCode, 'K1')
  assert.equal(parseScheduleAssignment(employee.shifts[7], ['K1', 'O4']).areaCode, 'O4')
  assert.equal(parseScheduleAssignment(employee.shifts[9], ['K1', 'O4']).kind, 'duty')
})

test('coarse and timed area codes resolve without mixing an existing exact block into its subareas', () => {
  assert.deepEqual(parseScheduleAssignment('N晚17-21', ['N1', 'N2', 'N3']), { kind: 'area', areaCode: 'N', variant: 'standard' })
  assert.deepEqual(parseScheduleAssignment('小夜U', ['ZU']), { kind: 'area', areaCode: 'U', variant: 'small-night' })
  const employees = [
    { employeeId: 'N0', name: '粗碼人員', title: '調度專員-N' },
    { employeeId: 'N1', name: '細碼人員', title: '調度專員-N' },
  ]
  const result = assignSchedulesToDispatchBlocks({
    blocks: [block('n', 'N', 'CAR-N'), block('n1', 'N1', 'CAR-N1'), block('n2', 'N2', 'CAR-N2')],
    schedules: [schedule('N0', '夜N'), schedule('N1', '夜N1')],
    employees,
    shift: 'night',
  })
  assert.deepEqual(result.blocks.map(item => item.drivers.map(person => person.employeeId)), [['N0'], ['N1'], []])
})

test('small-night assignment uses its dedicated block and falls back only when no dedicated variant exists', () => {
  const employees = [
    { employeeId: 'U1', name: '小夜專車', title: '調度專員-N' },
    { employeeId: 'B4', name: '小夜共車', title: '調度專員-N' },
  ]
  const zu = block('zu', 'ZU', 'CAR-ZU', 'small-night')
  const b4 = block('b4', 'B4', 'CAR-B4')
  const result = assignSchedulesToDispatchBlocks({
    blocks: [zu, b4],
    schedules: [schedule('U1', '小夜U'), schedule('B4', '小夜B4')],
    employees,
    shift: 'night',
  })
  assert.equal(result.blocks[0].drivers[0].employeeId, 'U1')
  assert.equal(result.blocks[1].drivers[0].employeeId, 'B4')
  assert.equal(result.unmatched.length, 0)
})

test('one merged schedule cell can direct the same PT employee to two different area stations', () => {
  const employee = { employeeId: 'PT1', name: '跨區人員', title: 'PT-早晚' }
  const result = assignSchedulesToDispatchBlocks({
    blocks: [block('b3', 'B3', 'CAR-B3'), block('b6', 'B6', 'CAR-B6')],
    schedules: [schedule('PT1', 'B3早07-12.5／B6晚16-20')],
    employees: [employee],
    shift: 'night',
  })
  assert.deepEqual(result.blocks.map(item => item.stations.map(person => person.employeeId)), [['PT1'], ['PT1']])
  assert.equal(result.unmatched.length, 0)
})

test('陳均瑜 O1晚夜17-01 produces one evening and one night assignment from the morning roster', () => {
  const source = JSON.parse(readFileSync('public/september-schedules.json', 'utf8'))
  const row = source.morning.find(row => row.employeeId === 'B0410')
  assert.equal(row.name, '陳均瑜')
  assert.equal(row.shifts[8], 'O1晚夜17-01')
  const employee = { employeeId: row.employeeId, name: row.name, title: row.title }
  const blocks = [
    { ...block('evening', 'O1', 'DAY'), shiftType: 'day' },
    block('night', 'O1', 'NIGHT'),
    block('small-night', 'O1', 'SMALL', 'small-night'),
  ]
  const schedules = [{ ...schedule(employee.employeeId, row.shifts[8]), shiftType: 'morning' }]
  const before = structuredClone({ blocks, schedules })
  for (const shift of ['day', 'night']) {
    const result = assignSchedulesToDispatchBlocks({ blocks, schedules: [...schedules, ...schedules], employees: [employee], shift })
    assert.equal(result.blocks.flatMap(block => block.stations).filter(p => p.employeeId === 'B0410').length, 1)
    assert.equal(result.blocks.find(block => block.blockId === (shift === 'day' ? 'evening' : 'night')).stations[0].employeeId, 'B0410')
    assert.deepEqual(result.unmatched, [])
  }
  assert.deepEqual({ blocks, schedules }, before)
})

test('compound parser consumes every period and area token and deduplicates identical slots', () => {
  for (const code of ['O1晚夜17-01', 'O1晚班＋夜班', '晚O1／夜O1', '晚O1+夜O1+夜O1']) {
    assert.deepEqual(parseScheduleAssignments(code, ['O1'], 'day').map(p => [p.areaCode, p.shift, p.variant]),
      [['O1', 'day', 'standard'], ['O1', 'night', 'standard']])
  }
  assert.deepEqual(parseScheduleAssignments('晚O1夜O2', ['O1', 'O2'], 'day').map(p => [p.areaCode, p.shift]),
    [['O1', 'day'], ['O2', 'night']])
  assert.deepEqual(parseScheduleAssignments('夜O1＋夜O2', ['O1', 'O2'], 'night').map(p => p.areaCode), ['O1', 'O2'])
  assert.deepEqual(parseScheduleAssignments('晚O1夜O2', ['O1'], 'day').map(p => [p.areaCode, p.shift]), [['O1', 'day']])
  assert.deepEqual(parseScheduleAssignments('例／休／夜監', ['O1'], 'night'), [])
})

test('manual small-night slot cannot swallow the same employee standard night slot', () => {
  const employee = { employeeId: 'B0410', name: '陳均瑜', title: 'PT-晚夜' }
  const manual = { ...block('small', 'O1', 'SMALL', 'small-night'), modifiedBy: 'admin', stations: [{ employeeId: employee.employeeId, employeeName: employee.name }] }
  const result = assignSchedulesToDispatchBlocks({ blocks: [manual, block('night', 'O1', 'NIGHT')],
    schedules: [schedule(employee.employeeId, '小夜O1／夜O1／夜O1')], employees: [employee], shift: 'night' })
  assert.deepEqual(result.blocks.map(b => b.stations.map(p => p.employeeId)), [['B0410'], ['B0410']])
  assert.deepEqual(result.unmatched, [])
})

test('manual relocation in the same variant still suppresses an automatic duplicate', () => {
  const employee = { employeeId: 'B0410', name: '陳均瑜', title: 'PT-晚夜' }
  const manual = { ...block('relocated', 'O2', 'MANUAL'), modifiedBy: 'admin', stations: [{ employeeId: employee.employeeId, employeeName: employee.name }] }
  const result = assignSchedulesToDispatchBlocks({ blocks: [manual, block('original', 'O1', 'AUTO')],
    schedules: [schedule(employee.employeeId, '夜O1')], employees: [employee], shift: 'night' })
  assert.deepEqual(result.blocks.map(b => b.stations.length), [1, 0])
})

test('small-night fallback never duplicates a person already in the same physical block', () => {
  const employee = { employeeId: 'B0410', name: '陳均瑜', title: 'PT-晚夜' }
  const result = assignSchedulesToDispatchBlocks({ blocks: [block('night', 'O1', 'NIGHT')],
    schedules: [schedule(employee.employeeId, '小夜O1／夜O1')], employees: [employee], shift: 'night' })
  assert.deepEqual(result.blocks[0].stations.map(p => p.employeeId), ['B0410'])
})

test('regular staff use vehicles and PT staff use stations, including small-night variant', () => {
  const employees = [
    { employeeId: '96504', name: '涂佑葦', title: '調度專員-N' },
    { employeeId: 'B3175', name: '李文良', title: '調度專員-E' },
    { employeeId: 'B5784', name: '李昱威', title: '調度專員-E' },
    { employeeId: 'P001', name: '駐點人員', title: 'PT-夜' },
  ]
  const result = assignSchedulesToDispatchBlocks({
    blocks: [block('o1-a', 'O1', 'RFW-7651'), block('o1-b', 'O1', 'RFX-6095'), block('o1-small', 'O1', 'BKP-0190', 'small-night')],
    schedules: [schedule('96504', '夜O1'), schedule('B3175', '夜O1'), schedule('B5784', '小夜O1'), schedule('P001', '夜O1')],
    employees,
    shift: 'night',
  })
  assert.deepEqual(result.blocks.slice(0, 2).map(item => item.drivers.length), [1, 1])
  assert.equal(result.blocks[2].drivers[0].employeeId, 'B5784')
  assert.equal(result.blocks.reduce((sum, item) => sum + item.stations.length, 0), 1)
  assert.equal(result.unmatched.length, 0)
})

test('more staff than vehicles are balanced and marked as shared vehicle', () => {
  const employees = ['E1', 'E2', 'E3'].map(employeeId => ({ employeeId, name: employeeId, title: '調度專員' }))
  const result = assignSchedulesToDispatchBlocks({
    blocks: [block('a1-a', 'A1', 'CAR-1'), block('a1-b', 'A1', 'CAR-2')],
    schedules: employees.map(item => schedule(item.employeeId, '夜A1')),
    employees,
    shift: 'night',
  })
  assert.deepEqual(result.blocks.map(item => item.drivers.length), [2, 1])
  assert.equal(result.blocks[0].assignmentStatus, 'shared-vehicle')
  assert.equal(result.unmatched.length, 0)
})

test('five regular staff across three vehicles are distributed 2, 2, 1', () => {
  const employees = ['E1', 'E2', 'E3', 'E4', 'E5'].map(employeeId => ({ employeeId, name: employeeId, title: '調度專員' }))
  const result = assignSchedulesToDispatchBlocks({
    blocks: [block('a1-a', 'A1', 'CAR-1'), block('a1-b', 'A1', 'CAR-2'), block('a1-c', 'A1', 'CAR-3')],
    schedules: employees.map(item => schedule(item.employeeId, '夜A1')),
    employees,
    shift: 'night',
  })
  assert.deepEqual(result.blocks.map(item => item.drivers.length), [2, 2, 1])
  assert.equal(result.blocks.filter(item => item.assignmentStatus === 'shared-vehicle').length, 2)
})

test('preview blocks use the selected date and never carry source people or manual state', () => {
  const source = {
    ...block('source', 'A1', 'CAR-1'),
    id: '2026-09-09_night_left_3',
    blockId: '2026-09-09_night_left_3',
    date: '2026-09-09',
    drivers: [{ employeeId: 'E1', employeeName: '來源人員' }],
    modifiedBy: 'D001',
  }
  const [preview] = buildDispatchPreviewBlocks([source], '2026-09-10')
  assert.equal(preview.id, '2026-09-10_night_left_3')
  assert.equal(preview.date, '2026-09-10')
  assert.equal(preview.status, 'preview')
  assert.deepEqual(preview.drivers, [])
  assert.equal(preview.modifiedBy, '')
})

test('2026-09-09 formal dispatch blocks remain intact and schedule assignment is unique', () => {
  const source = JSON.parse(readFileSync('public/september-schedules.json', 'utf8'))
  const employees = JSON.parse(readFileSync('output/employee-master.json', 'utf8'))
  const blocks = JSON.parse(readFileSync('output/dispatch-blocks-20260909-simulation.json', 'utf8')).blocks
  const rowsByEmployee = new Map()
  for (const item of [...source.morning.map(row => ({ row, shiftType: 'morning' })), ...source.night.map(row => ({ row, shiftType: 'night' }))]) {
    rowsByEmployee.set(item.row.employeeId, [...(rowsByEmployee.get(item.row.employeeId) || []), item])
  }
  const schedules = employees.map(employee => {
    const rows = rowsByEmployee.get(employee.employeeId)
    const codes = [...new Set(rows.map(item => item.row.shifts[8]).filter(Boolean))]
    return {
      id: `${employee.employeeId}_2026-09-09`,
      date: '2026-09-09',
      employeeId: employee.employeeId,
      employeeName: employee.name,
      title: employee.title,
      shiftType: rows[0].shiftType,
      scheduleCode: codes.join('／'),
      scheduleLabel: codes.join('／'),
      leaveType: '',
      source: 'september-schedules.json',
      status: 'active',
      note: '',
      modifiedBy: '',
    }
  })
  const day = assignSchedulesToDispatchBlocks({ blocks, schedules, employees, shift: 'day' })
  const night = assignSchedulesToDispatchBlocks({ blocks, schedules, employees, shift: 'night' })
  const summarize = result => ({
    ...summarizeDispatchAssignment(result.blocks, result.unmatched),
    drivers: result.blocks.reduce((sum, item) => sum + item.drivers.length, 0),
    stations: result.blocks.reduce((sum, item) => sum + item.stations.length, 0),
    unmatchedCodes: result.unmatched.map(item => `${item.employeeId}:${item.scheduleCode}`),
  })
  const daySummary = summarize(day)
  const nightSummary = summarize(night)
  console.log('2026-09-09 admin dispatch assignment', { day: daySummary, night: nightSummary })
  assert.equal(daySummary.blocks, 89)
  assert.equal(nightSummary.blocks, 94)
  assert.ok(daySummary.positions >= daySummary.uniquePeople)
  assert.ok(nightSummary.positions >= nightSummary.uniquePeople)
  assert.equal(daySummary.pendingPeople, 0)
  assert.equal(nightSummary.pendingPeople, 0)
})

test('2026-09-10 through 2026-09-12 produce non-empty preview assignments from schedule records', () => {
  const source = JSON.parse(readFileSync('public/september-schedules.json', 'utf8'))
  const employees = JSON.parse(readFileSync('output/employee-master.json', 'utf8'))
  const template = JSON.parse(readFileSync('output/dispatch-blocks-20260909-simulation.json', 'utf8')).blocks
  const rowsByEmployee = new Map()
  for (const item of [...source.morning.map(row => ({ row, shiftType: 'morning' })), ...source.night.map(row => ({ row, shiftType: 'night' }))]) {
    rowsByEmployee.set(item.row.employeeId, [...(rowsByEmployee.get(item.row.employeeId) || []), item])
  }
  const results = []
  for (const day of [10, 11, 12]) {
    const date = `2026-09-${day}`
    const blocks = buildDispatchPreviewBlocks(template, date)
    const schedules = employees.map(employee => {
      const rows = rowsByEmployee.get(employee.employeeId)
      const codes = [...new Set(rows.map(item => item.row.shifts[day - 1]).filter(Boolean))]
      return {
        id: `${employee.employeeId}_${date}`, date, employeeId: employee.employeeId, employeeName: employee.name,
        title: employee.title, shiftType: rows[0].shiftType, scheduleCode: codes.join('／'), scheduleLabel: codes.join('／'),
        leaveType: '', source: 'september-schedules.json', status: 'active', note: '', modifiedBy: '',
      }
    })
    const dayResult = assignSchedulesToDispatchBlocks({ blocks, schedules, employees, shift: 'day' })
    const nightResult = assignSchedulesToDispatchBlocks({ blocks, schedules, employees, shift: 'night' })
    const daySummary = summarizeDispatchAssignment(dayResult.blocks, dayResult.unmatched)
    const nightSummary = summarizeDispatchAssignment(nightResult.blocks, nightResult.unmatched)
    results.push({ date, day: daySummary, night: nightSummary })
    assert.equal(daySummary.blocks, 89)
    assert.equal(nightSummary.blocks, 94)
    assert.ok(daySummary.positions > 0)
    assert.ok(nightSummary.positions > 0)
  }
  console.log('future dispatch previews', results)
})
