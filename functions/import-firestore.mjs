import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(fs.readFileSync(path.join(root, 'public/september-schedules.json'), 'utf8'))
const master = JSON.parse(fs.readFileSync(path.join(root, 'output/employee-master.json'), 'utf8'))
const areas = JSON.parse(fs.readFileSync(path.join(root, 'areas.json'), 'utf8'))
const clean = value => String(value ?? '').trim()
const cleanId = value => clean(value).toUpperCase()
const masterById = new Map(master.map(row => [cleanId(row.employeeId), row]))
const rows = [
  ...(source.morning || []).map(row => ({ ...row, shiftType: 'morning' })),
  ...(source.night || []).map(row => ({ ...row, shiftType: 'night' })),
]

if (source.month !== '2026-09') throw new Error(`Unexpected schedule month: ${source.month}`)
if (master.length !== 750 || masterById.size !== 750) throw new Error(`Unexpected employee master size: ${master.length}/${masterById.size}`)

const rowsByEmployee = new Map()
const excluded = []
for (const row of rows) {
  const employeeId = cleanId(row.employeeId)
  const employee = masterById.get(employeeId)
  const reasons = []
  if (!employee) reasons.push('employeeId_not_in_employee_master')
  if (employee && clean(row.name) !== clean(employee.name)) reasons.push('name_mismatch')
  if (!Array.isArray(row.shifts) || row.shifts.length !== 30) reasons.push('invalid_shift_day_count')
  if (reasons.length) {
    excluded.push({ rowId: row.rowId, employeeId, employeeName: clean(row.name), excludedCells: Array.isArray(row.shifts) ? row.shifts.length : 0, reasons })
    continue
  }
  const employeeRows = rowsByEmployee.get(employeeId) || []
  employeeRows.push(row)
  rowsByEmployee.set(employeeId, employeeRows)
}

const missingEmployees = [...masterById.keys()].filter(employeeId => !rowsByEmployee.has(employeeId))
if (missingEmployees.length) throw new Error(`Employees missing from schedule source: ${missingEmployees.join(', ')}`)

const leaveType = code => code.includes('病') ? '病假' : code.includes('事') ? '事假' : code.includes('特') ? '特休' : code === '假' ? '假' : ['例', '休', '休上', '慰'].includes(code) ? code : ''
const records = []
for (const [employeeId, employee] of masterById) {
  const employeeRows = rowsByEmployee.get(employeeId)
  for (let index = 0; index < 30; index += 1) {
    const date = `2026-09-${String(index + 1).padStart(2, '0')}`
    const codes = []
    for (const row of employeeRows) {
      const code = clean(row.shifts[index])
      if (code && !codes.includes(code)) codes.push(code)
    }
    const scheduleCode = codes.join('／')
    records.push({
      id: `${employeeId}_${date}`,
      date,
      employeeId,
      employeeName: clean(employee.name),
      shiftType: employeeRows[0].shiftType,
      scheduleCode,
      scheduleLabel: scheduleCode,
      leaveType: codes.length === 1 ? leaveType(codes[0]) : '',
      source: employeeRows.map(row => `public/september-schedules.json:${row.rowId}`).join(';'),
      status: 'active',
      note: '',
      modifiedBy: 'system-import',
    })
  }
}

const uniqueKeys = new Set(records.map(record => `${record.employeeId}|${record.date}`))
if (records.length !== 22500 || uniqueKeys.size !== records.length) throw new Error(`Unsafe schedule result: ${records.length}/${uniqueKeys.size}`)

for (let index = 0; index < records.length; index += 400) {
  const batch = db.batch()
  for (const record of records.slice(index, index + 400)) {
    batch.set(db.collection('scheduleRecords').doc(record.id), { ...record, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  await batch.commit()
}

const areaRecords = Object.entries(areas).map(([areaCode, [areaName, defaultVehicleType, defaultVehicleNo, defaultWorkFocus]], sortOrder) => ({ areaCode, areaName, defaultVehicleType, defaultVehicleNo, defaultStation: '', defaultWorkFocus, defaultBalanceArea: '', active: true, sortOrder }))
for (let index = 0; index < areaRecords.length; index += 400) {
  const batch = db.batch()
  for (const area of areaRecords.slice(index, index + 400)) batch.set(db.collection('areaMaster').doc(area.areaCode), area, { merge: true })
  await batch.commit()
}

console.log(JSON.stringify({
  scheduleRecords: records.length,
  employees: new Set(records.map(record => record.employeeId)).size,
  dateRange: ['2026-09-01', '2026-09-30'],
  duplicateEmployeeDate: records.length - uniqueKeys.size,
  areaMaster: areaRecords.length,
  excluded,
}, null, 2))
