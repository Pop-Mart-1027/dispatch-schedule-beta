import type { DispatchBlock, DispatchBlockPerson } from './dispatch-blocks-firestore'
import type { ScheduleRecord } from './schedule-firestore'
import { employeeAdminOrder } from './admin-employee-order'

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
  people.forEach((person, index) => blocks[index % blocks.length][field].push(person))
}

export function assignSchedulesToDispatchBlocks({
  blocks,
  schedules,
  employees,
  shift,
}: {
  blocks: DispatchBlock[]
  schedules: ScheduleRecord[]
  employees: AssignmentEmployee[]
  shift: 'day' | 'night'
}) {
  const expectedScheduleShift = shift === 'day' ? 'morning' : 'night'
  const selectedBlocks: AssignedDispatchBlock[] = blocks
    .filter(block => block.shiftType === shift)
    .map(block => ({
      ...block,
      drivers: block.modifiedBy?.trim() ? [...block.drivers] : [],
      stations: block.modifiedBy?.trim() ? [...block.stations] : [],
      assistants: block.modifiedBy?.trim() ? [...block.assistants] : [],
      assignmentStatus: 'normal',
    }))
  const employeeMap = new Map(employees.map(employee => [employee.employeeId, employee]))
  const availableAreaCodes = selectedBlocks.map(block => block.areaCode || '').filter(Boolean)
  const manuallyAssignedIds = new Set(
    selectedBlocks
      .filter(block => block.modifiedBy?.trim())
      .flatMap(block => [...block.drivers, ...block.stations, ...block.assistants])
      .map(person => person.employeeId)
      .filter(Boolean),
  )
  const grouped = new Map<string, Array<{ employee: AssignmentEmployee; scheduleCode: string }>>()
  const unmatched: UnmatchedScheduleAssignment[] = []

  schedules
    .filter(record => record.shiftType === expectedScheduleShift)
    .forEach(record => {
      const employee = employeeMap.get(record.employeeId) || {
        employeeId: record.employeeId,
        name: record.employeeName,
        title: record.title || '',
      }
      const scheduleCodes = [...new Set(record.scheduleCode.split('／').map(value => value.trim()).filter(Boolean))]
      scheduleCodes.forEach(scheduleCode => {
        const parsed = parseScheduleAssignment(scheduleCode, availableAreaCodes)
        if (parsed.kind !== 'area') return
        const key = `${parsed.areaCode}|${parsed.variant}`
        const existing = grouped.get(key) || []
        if (!existing.some(row => row.employee.employeeId === employee.employeeId)) {
          grouped.set(key, [...existing, { employee, scheduleCode }])
        }
      })
    })

  grouped.forEach((rows, key) => {
    const [areaCode, variant] = key.split('|')
    const exactAreaMatches = (block: AssignedDispatchBlock) =>
      normalizedCode(block.areaCode || '') === areaCode
    const familyAreaMatches = (block: AssignedDispatchBlock) => {
      const blockArea = normalizedCode(block.areaCode || '')
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
