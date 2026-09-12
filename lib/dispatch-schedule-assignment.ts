import { dispatchAreaCodes, dispatchAreaDisplay, normalizeDispatchAreaCode } from './dispatch-area'
import type { DispatchBlock, DispatchBlockPerson } from './dispatch-blocks-firestore'
import type { ScheduleRecord } from './schedule-firestore'
import { employeeAdminOrder } from './admin-employee-order'
import { dispatchShifts, parseDispatchShifts, type DispatchShift } from './dispatch-shifts'

export type AssignmentEmployee = {
  employeeId: string
  name: string
  title: string
}

export type DispatchAssignmentStatus = 'normal' | 'shared-vehicle' | 'no-driver' | 'manual'

export type AssignedDispatchBlock = DispatchBlock & {
  assignmentStatus: DispatchAssignmentStatus
}

export type UnmatchedScheduleAssignment = {
  employeeId: string
  employeeName: string
  title: string
  scheduleCode: string
  reason: string
}

export type ParsedScheduleAssignment = {
  kind: 'area' | 'duty' | 'off' | 'special'
  areaCode: string
  variant: 'standard' | 'small-night' | 'z'
}

const offCodes = new Set(['例', '休', '慰', '病', '病假', '事', '事假', '特休', '假'])

function normalizedCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

function baseAreaCode(value: string) {
  const code = normalizedCode(value)
  return code.startsWith('Z') && code.length > 1 ? code.slice(1) : code
}

function blockVariant(block: DispatchBlock): ParsedScheduleAssignment['variant'] {
  if (block.variantCode === 'small-night' || /小夜/.test(`${block.areaName} ${block.vehicleNo}`)) return 'small-night'
  if (block.variantCode.toUpperCase() === 'Z' || block.areaCode?.toUpperCase().startsWith('Z')) return 'z'
  return 'standard'
}

export function parseScheduleAssignment(scheduleCode: string, availableAreaCodes: string[]): ParsedScheduleAssignment {
  const code = normalizedCode(scheduleCode)
  if (!code || offCodes.has(code) || /病|事假|特休|公假|喪|婚假|陪/.test(code)) {
    return { kind: 'off', areaCode: '', variant: 'standard' }
  }
  if (code.includes('監')) return { kind: 'duty', areaCode: '', variant: 'standard' }
  if (/主官|主任|副主任/.test(code)) return { kind: 'duty', areaCode: '', variant: 'standard' }

  const areas = [...new Set(availableAreaCodes.map(normalizedCode).filter(Boolean))]
  const tokens = code.match(/[A-Z]+\d*/g) || []
  const areaCode = tokens.find(token =>
    areas.some(area => area === token || (!/\d/.test(token) && baseAreaCode(area).startsWith(token))),
  )

  if (!areaCode) return { kind: 'special', areaCode: '', variant: 'standard' }
  return {
    kind: 'area',
    areaCode,
    variant: code.includes('小夜') ? 'small-night' : areaCode.startsWith('Z') ? 'z' : 'standard',
  }
}

// A persisted row's shiftType describes its source roster, not every time slot
// encoded in its cell (for example O1晚夜17-01 is stored on the morning roster).
export function parseScheduleAssignments(
  scheduleCode: string,
  availableAreaCodes: string[],
  defaultShift: 'day' | 'night',
  dispatchShift?: DispatchShift,
): Array<ParsedScheduleAssignment & { shift: 'day' | 'night' }> {
  const result: Array<ParsedScheduleAssignment & { shift: 'day' | 'night' }> = []
  const periodsInCell = [...normalizedCode(scheduleCode).matchAll(/小夜|晚班|夜班|早班|日班|晚|夜|早|日/g)]
  const spansShifts = periodsInCell.some(period => period[0].includes('夜'))
    && periodsInCell.some(period => !period[0].includes('夜'))
  let inheritedArea = ''
  for (const part of normalizedCode(scheduleCode).split(/[／/＋+、，,；;＆&]/).filter(Boolean)) {
    if (dispatchShift && !parseDispatchShifts(part).includes(dispatchShift)) continue
    if (parseScheduleAssignment(part, availableAreaCodes).kind === 'off' || /監|主官|主任/.test(part)) continue
    // Keep unknown tokens as boundaries too: 夜O2 must never inherit O1 merely
    // because this block list has no O2.
    const areas = [...part.matchAll(/[A-Z]+\d*/g)]
    const periods = [...part.matchAll(/小夜|晚班|夜班|早班|日班|晚|夜|早|日/g)]
    const usedAreas = new Set<number>()
    const add = (areaCode: string, period?: string) => {
      if (!areaCode) return
      if (dispatchShift && !parseDispatchShifts(period).includes(dispatchShift)) return
      const parsed = parseScheduleAssignment(`${period || ''}${areaCode}`, availableAreaCodes)
      // Preserve existing single-roster routing; only a cell explicitly spanning
      // both periods overrides its persisted source shift.
      const shift = !dispatchShift && spansShifts && period ? (period.includes('夜') ? 'night' : 'day') : defaultShift
      if (parsed.kind === 'area' && !result.some(row => row.areaCode === parsed.areaCode && row.variant === parsed.variant && row.shift === shift)) {
        result.push({ ...parsed, shift })
      }
    }
    periods.forEach((period, index) => {
      const nextPeriod = periods[index + 1]?.index ?? part.length
      const area = areas.find(area => area.index! >= period.index! + period[0].length && area.index! < nextPeriod)
        || areas.filter(area => area.index! < period.index!).at(-1)
        || (dispatchShift ? areas.find(area => area.index! >= nextPeriod) : undefined)
      if (area) usedAreas.add(area.index!)
      add(area?.[0] || inheritedArea, period[0])
    })
    for (const area of areas) {
      if (!usedAreas.has(area.index!)) add(area[0], periods.filter(period => period.index! < area.index!).at(-1)?.[0] || periods[0]?.[0])
    }
    if (areas.length) inheritedArea = areas.at(-1)![0]
  }
  return result
}

export function dispatchBlockAssignmentStatus(block: DispatchBlock): DispatchAssignmentStatus {
  if (block.modifiedBy?.trim()) return 'manual'
  if (block.drivers.length > 1) return 'shared-vehicle'
  if (block.drivers.length === 0) return 'no-driver'
  return 'normal'
}

function personFrom(employee: AssignmentEmployee, scheduleCode: string): DispatchBlockPerson {
  return { employeeId: employee.employeeId, employeeName: employee.name, sourceText: scheduleCode }
}

function addRoundRobin(blocks: AssignedDispatchBlock[], people: DispatchBlockPerson[], field: 'drivers' | 'stations') {
  people.forEach((person, index) => {
    // A small-night fallback can resolve to the same physical standard block.
    if (!blocks.some(block => block[field].some(existing => existing.employeeId === person.employeeId))) {
      blocks[index % blocks.length][field].push(person)
    }
  })
}

export function assignSchedulesToDispatchBlocks({
  blocks,
  schedules,
  employees,
  shift,
  dispatchShift,
}: {
  blocks: DispatchBlock[]
  schedules: ScheduleRecord[]
  employees: AssignmentEmployee[]
  shift: 'day' | 'night'
  dispatchShift?: DispatchShift
}) {
  const validAreaCodes = dispatchAreaCodes(blocks)
  const canonicalArea = (code: string) => normalizeDispatchAreaCode(code, validAreaCodes) || ''
  const eligiblePeople = new Set(schedules.filter(record => dispatchShift && parseDispatchShifts(record.scheduleCode).includes(dispatchShift))
    .map(record => `${record.date}|${record.employeeId}`))
  const manualPeople = (block: DispatchBlock, people: DispatchBlockPerson[]) => !block.modifiedBy?.trim() ? []
    : people.filter(person => !dispatchShift || eligiblePeople.has(`${block.date}|${person.employeeId}`))
  const selectedBlocks: AssignedDispatchBlock[] = blocks
    .filter(block => block.shiftType === shift)
    .map(block => ({
      ...block,
      drivers: manualPeople(block, block.drivers),
      stations: manualPeople(block, block.stations),
      assistants: manualPeople(block, block.assistants),
      assignmentStatus: 'normal',
    }))
  const employeeMap = new Map(employees.map(employee => [employee.employeeId, employee]))
  const availableAreaCodes = selectedBlocks.flatMap(block => [block.areaCode || '', canonicalArea(block.areaCode || '')]).filter(Boolean)
  const grouped = new Map<string, Array<{ employee: AssignmentEmployee; scheduleCode: string }>>()
  const unmatched: UnmatchedScheduleAssignment[] = []

  schedules
    .forEach(record => {
      const employee = employeeMap.get(record.employeeId) || {
        employeeId: record.employeeId,
        name: record.employeeName,
        title: record.title || '',
      }
      const scheduleCode = record.scheduleCode
      parseScheduleAssignments(scheduleCode, availableAreaCodes, record.shiftType === 'morning' ? 'day' : 'night', dispatchShift).forEach(parsed => {
        if (parsed.shift !== shift) return
        const key = `${canonicalArea(parsed.areaCode)}|${parsed.variant}`
        const existing = grouped.get(key) || []
        if (!existing.some(row => row.employee.employeeId === employee.employeeId)) {
          grouped.set(key, [...existing, { employee, scheduleCode }])
        }
      })
    })

  grouped.forEach((rows, key) => {
    const [areaCode, variant] = key.split('|')
    const exactAreaMatches = (block: AssignedDispatchBlock) =>
      canonicalArea(block.areaCode || '') === areaCode
    const familyAreaMatches = (block: AssignedDispatchBlock) => {
      const blockArea = canonicalArea(block.areaCode || '')
      return !/\d/.test(areaCode) && baseAreaCode(blockArea).startsWith(areaCode)
    }
    const exactAreaBlocks = selectedBlocks.filter(exactAreaMatches)
    const familyAreaBlocks = selectedBlocks.filter(familyAreaMatches)
    let candidates = exactAreaBlocks.filter(block => blockVariant(block) === variant)
    if (!candidates.length) {
      candidates = familyAreaBlocks.filter(block => blockVariant(block) === variant)
    }
    if (!candidates.length && variant === 'small-night') {
      candidates = exactAreaBlocks.filter(block => blockVariant(block) === 'standard')
      if (!candidates.length) {
        candidates = familyAreaBlocks.filter(block => blockVariant(block) === 'standard')
      }
    }
    const automaticBlocks = candidates.filter(block => !block.modifiedBy?.trim())
    // An override occupies this shift/variant only, not all of the employee's
    // other assignments in the same shift (small-night and standard can coexist).
    const manuallyAssignedIds = new Set(selectedBlocks.filter(block => block.modifiedBy?.trim()
      && (blockVariant(block) === variant || candidates.includes(block)))
      .flatMap(block => [...block.drivers, ...block.stations, ...block.assistants])
      .map(person => person.employeeId).filter(Boolean))
    const remaining = rows
      .filter(row => !manuallyAssignedIds.has(row.employee.employeeId))
      .sort((left, right) => employeeAdminOrder(left.employee, right.employee))
    if (!automaticBlocks.length) {
      remaining.forEach(({ employee, scheduleCode }) => {
        // A month move/re-add explicitly cancels this person's older override.
        // Preserve everyone else and vehicle/work-focus edits in the same block.
        const resetCandidates = candidates.filter(block => block.monthAssignmentResetIds?.includes(employee.employeeId));
        if (resetCandidates.length) {
          const field = employee.title.startsWith('PT-') ? 'stations' : 'drivers';
          const target = [...resetCandidates].sort((a,b) => a[field].length-b[field].length)[0];
          target[field].push(personFrom(employee,scheduleCode));
        } else unmatched.push({ ...employee, employeeName: employee.name, scheduleCode, reason: candidates.length ? '該區 block 已由人工修改' : '找不到相同區域與 variant 的 block' });
      });
      return
    }
    const drivers = remaining.filter(row => !row.employee.title.startsWith('PT-')).map(row => personFrom(row.employee, row.scheduleCode))
    const stations = remaining.filter(row => row.employee.title.startsWith('PT-')).map(row => personFrom(row.employee, row.scheduleCode))
    addRoundRobin(automaticBlocks, drivers, 'drivers')
    addRoundRobin(automaticBlocks, stations, 'stations')
  })

  selectedBlocks.forEach(block => { block.assignmentStatus = dispatchBlockAssignmentStatus(block) })
  return { blocks: selectedBlocks, unmatched }
}

// Read-only projection. Keep persisted day/night templates and all vehicle/work
// fields intact; never write dispatchShift or the projected arrays to Firestore.
export type ShiftDispatchBlock = AssignedDispatchBlock & { dispatchShift: DispatchShift }

// Card identity is independent of the source template/assignment document ID.
// This merge is display-only and must never be persisted back to source blocks.
export function mergeShiftDispatchCards(blocks: ShiftDispatchBlock[]): ShiftDispatchBlock[] {
  const validAreas = dispatchAreaCodes(blocks)
  const normalizeKey = (value: string) => value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '')
  const mergeText = (...values: string[]) => [...new Set(values.flatMap(value =>
    value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
  ))].join('\n')
  const groups = new Map<string, { card: ShiftDispatchBlock; employeeIds: Set<string> }>()
  for (const source of blocks) {
    const block = dispatchAreaDisplay(source, validAreas)
    const area = normalizeKey(block.areaCode || block.areaName || '')
    const vehicle = normalizeKey(block.vehicleNo || '').replace(/[‐‑‒–—−]/g, '-')
    const key = JSON.stringify([block.date, block.dispatchShift, area, vehicle])
    let group = groups.get(key)
    if (!group) {
      group = { card: { ...block, drivers: [], stations: [], assistants: [] }, employeeIds: new Set() }
      groups.set(key, group)
    }
    const { card, employeeIds } = group
    for (const field of ['drivers', 'stations', 'assistants'] as const) {
      for (const person of block[field]) {
        if (!person.employeeId || employeeIds.has(person.employeeId)) continue
        employeeIds.add(person.employeeId)
        card[field].push(person)
      }
    }
    card.workFocus = mergeText(card.workFocus, block.workFocus)
    card.balanceArea = mergeText(card.balanceArea, block.balanceArea)
    card.note = mergeText(card.note, block.note)
    if (!card.modifiedBy?.trim() && block.modifiedBy?.trim()) card.modifiedBy = block.modifiedBy
    card.assignmentStatus = dispatchBlockAssignmentStatus(card)
  }
  return [...groups.values()].map(group => group.card)
}

export function buildShiftDispatchBlocks({ date, blocks, schedules, employees }: {
  date: string
  blocks: DispatchBlock[]
  schedules: ScheduleRecord[]
  employees: AssignmentEmployee[]
}): ShiftDispatchBlock[] {
  const dailyBlocks = blocks.filter(block => block.date === date)
  const dailySchedules = schedules.filter(record => record.date === date)
  return dispatchShifts.flatMap(dispatchShift => {
    const assigned = (['day', 'night'] as const).flatMap(shift => assignSchedulesToDispatchBlocks({
      blocks: dailyBlocks, schedules: dailySchedules, employees, shift, dispatchShift,
    }).blocks)
    // A bare period (e.g. "早") specifies attendance but no new area. Retain its
    // existing formal placement rather than guessing an area or dropping it.
    const periodOnlyIds = new Set(dailySchedules.filter(record =>
      parseDispatchShifts(record.scheduleCode).includes(dispatchShift)
      && !/[A-Z]|監|主官|主任/i.test(record.scheduleCode),
    ).map(record => record.employeeId))
    const originals = new Map(dailyBlocks.map(block => [block.id, block]))
    for (const block of assigned) {
      if (block.modifiedBy?.trim()) continue
      const original = originals.get(block.id)!
      for (const field of ['drivers', 'stations', 'assistants'] as const) {
        block[field].push(...original[field].filter(person => periodOnlyIds.has(person.employeeId)
          && !block[field].some(existing => existing.employeeId === person.employeeId)))
      }
    }
    // Preserve manual placement first; duplicates from multiple source rosters
    // must not duplicate one employee within the same date + displayed shift.
    const seen = new Set<string>()
    const unique = new Map<string, ShiftDispatchBlock>()
    for (const block of [...assigned].sort((a, b) => Number(Boolean(b.modifiedBy?.trim())) - Number(Boolean(a.modifiedBy?.trim())))) {
      const keep = (people: DispatchBlockPerson[]) => people.filter(person => {
        if (!person.employeeId || seen.has(person.employeeId)) return false
        seen.add(person.employeeId)
        return true
      })
      const projected = { ...block, dispatchShift, drivers: keep(block.drivers), stations: keep(block.stations), assistants: keep(block.assistants) }
      projected.assignmentStatus = dispatchBlockAssignmentStatus(projected)
      unique.set(block.id, projected)
    }
    return mergeShiftDispatchCards(assigned.map(block => unique.get(block.id)!))
  })
}

export function dispatchAssignmentStatusLabel(status: DispatchAssignmentStatus) {
  if (status === 'shared-vehicle') return '⚠ 多人共車'
  if (status === 'no-driver') return '無駕駛'
  if (status === 'manual') return '人工修改'
  return '正常'
}

export function summarizeDispatchAssignment(
  blocks: AssignedDispatchBlock[],
  unmatched: UnmatchedScheduleAssignment[],
) {
  const people = blocks.flatMap(block => [
    ...block.drivers,
    ...block.stations,
    ...block.assistants,
  ])
  return {
    blocks: blocks.length,
    positions: people.length,
    uniquePeople: new Set(people.map(person => person.employeeId).filter(Boolean)).size,
    sharedVehicleBlocks: blocks.filter(block => block.assignmentStatus === 'shared-vehicle').length,
    noDriverBlocks: blocks.filter(block => block.assignmentStatus === 'no-driver').length,
    pendingPeople: unmatched.length,
  }
}
