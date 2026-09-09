'use strict'

function parseCsv(text) {
  const rows = []; let row = []; let value = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (character === ',' && !quoted) { row.push(value); value = '' }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value); rows.push(row); row = []; value = ''
    } else value += character
  }
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows
}

const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const vehicleLike = value => /\b[A-Z]{2,4}-?\d{3,4}\b/i.test(clean(value)) || clean(value).includes('/')
const areaCodeFrom = label => clean(label).toUpperCase().match(/([A-Z]{1,2}\d*)\s*區/)?.[1] || clean(label).toUpperCase().match(/([A-Z]\d*)\s*小夜/)?.[1] || null
const variantFrom = label => /小夜/.test(label) ? 'small-night' : areaCodeFrom(label)?.startsWith('Z') ? 'Z' : 'standard'

function buildMatcher(employees) {
  const sorted = [...employees].filter(item => item.employeeId && item.name).sort((left, right) => right.name.length - left.name.length)
  return cell => sorted.filter(person => clean(cell).includes(person.name)).filter((person, index, all) => all.findIndex(item => item.employeeId === person.employeeId) === index)
}

function createBlock({ date, shiftType, sourceSheet, row, side, areaName, vehicleNo }) {
  const normalizedVehicle = clean(vehicleNo)
  const confirmedZK4 = areaCodeFrom(areaName) === 'K4' && normalizedVehicle === 'BFR-1731'
  return { date, shiftType, blockId: `${date}_${shiftType}_${side}_${row}`, areaCode: confirmedZK4 ? 'ZK4' : areaCodeFrom(areaName), areaName: confirmedZK4 ? '永康 ZK4區' : clean(areaName), variantCode: confirmedZK4 ? 'Z' : variantFrom(areaName), vehicleNo: normalizedVehicle, vehicleType: '', drivers: [], stations: [], assistants: [], workFocus: '', balanceArea: '', note: '', sourceSheet, sourceRow: row, status: 'active', modifiedBy: '' }
}

function addPeople(block, cell, role, row, match, conflicts) {
  const people = match(cell)
  const target = role === 'driver' ? block.drivers : role === 'station' ? block.stations : block.assistants
  for (const person of people) if (!target.some(item => item.employeeId === person.employeeId)) target.push({ employeeId: person.employeeId, employeeName: person.name, sourceText: clean(cell), sourceRow: row })
  const candidate = clean(cell)
  if (!people.length && /^[\u3400-\u9fff]{2,4}(?:\s|\d|早|晚|夜|國上|小夜|$)/.test(candidate) && !/^(駕駛|駐點|隨車|工作重點|小夜|大夜|平衡區域|機動)/.test(candidate)) conflicts.push({ sourceSheet: block.sourceSheet, sourceRow: row, blockId: block.blockId, originalText: candidate, reason: 'employee-name-not-exact' })
}

function parseDay(rows, date, employees) {
  const blocks = []; const conflicts = []; const match = buildMatcher(employees); let block = null; let secondRole = 'station'
  for (let index = 0; index < rows.length; index += 1) {
    const [a = '', b = '', c = ''] = rows[index].map(clean)
    if (a && b && vehicleLike(b) && (areaCodeFrom(a) || /小夜\s*車|車在維修/.test(a))) { block = createBlock({ date, shiftType: 'day', sourceSheet: '雙北今日派工單看這邊', row: index + 1, side: 'single', areaName: a, vehicleNo: b }); blocks.push(block); secondRole = 'station'; continue }
    if (!block) continue
    if (/^駕駛/.test(a)) { secondRole = /隨車/.test(b) ? 'assistant' : 'station'; continue }
    addPeople(block, a, 'driver', index + 1, match, conflicts); addPeople(block, b, secondRole, index + 1, match, conflicts)
    if (c && !/^(工作重點|平衡區域)$/.test(c)) block.workFocus = [block.workFocus, c].filter(Boolean).join('\n')
  }
  return { blocks, conflicts }
}

function parseNight(rows, date, sourceSheet, employees) {
  const blocks = []; const conflicts = []; const match = buildMatcher(employees); const states = { left: { block: null, secondRole: 'station' }, right: { block: null, secondRole: 'station' } }
  for (let index = 0; index < rows.length; index += 1) {
    for (const [side, personIndex, secondIndex, focusIndex] of [['left', 0, 1, 2], ['right', 7, 8, 9]]) {
      const person = clean(rows[index][personIndex]); const second = clean(rows[index][secondIndex]); const focus = clean(rows[index][focusIndex]); const state = states[side]
      if (person && second && vehicleLike(second) && (areaCodeFrom(person) || /小夜|車在維修|中永和/.test(person))) { state.block = createBlock({ date, shiftType: 'night', sourceSheet, row: index + 1, side, areaName: person, vehicleNo: second }); blocks.push(state.block); state.secondRole = 'station'; continue }
      if (!state.block) continue
      if (/^駕駛/.test(person)) { state.secondRole = /隨車/.test(second) ? 'assistant' : 'station'; continue }
      addPeople(state.block, person, 'driver', index + 1, match, conflicts); addPeople(state.block, second, state.secondRole, index + 1, match, conflicts)
      if (focus && !/^(工作重點|平衡區域)$/.test(focus)) state.block.workFocus = [state.block.workFocus, focus].filter(Boolean).join('\n')
    }
  }
  return { blocks, conflicts }
}

module.exports = { parseCsv, parseDay, parseNight, areaCodeFrom }
