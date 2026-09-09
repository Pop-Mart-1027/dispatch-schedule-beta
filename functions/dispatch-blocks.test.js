'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const simulation = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'output', 'dispatch-blocks-20260909-simulation.json'), 'utf8'))

test('2026-09-09 dispatchBlocks staging totals stay intact', () => {
  const day = simulation.blocks.filter(block => block.shiftType === 'day')
  const night = simulation.blocks.filter(block => block.shiftType === 'night')
  const people = simulation.blocks.flatMap(block => [...block.drivers, ...block.stations, ...block.assistants])
  assert.equal(day.length, 89)
  assert.equal(night.length, 94)
  assert.equal(people.length, 351)
  assert.equal(new Set(people.map(person => person.employeeId)).size, 333)
  assert.equal(night.flatMap(block => block.drivers).length, 75)
  assert.equal(night.flatMap(block => block.stations).length, 34)
  assert.equal(night.flatMap(block => block.assistants).length, 1)
})

test('K4 multi-vehicle blocks remain independent', () => {
  const dayK4 = simulation.blocks.filter(block => block.shiftType === 'day' && block.areaCode === 'K4')
  assert.deepEqual(new Set(dayK4.map(block => block.vehicleNo)), new Set(['RFV-1019', 'BFR-1731', 'RDX-6902(小夜車)']))
  assert.equal(simulation.summary.oldSingleCardMergedBlocks, 43)
})

test('special blocks keep null areaCode', () => {
  assert.equal(simulation.blocks.filter(block => !block.areaCode).length, 9)
})
