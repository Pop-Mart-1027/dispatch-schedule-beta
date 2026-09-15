import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/dispatch-business-date.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
const { dispatchBusinessDate, initialDispatchShift, isDispatchNightWindow } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

for (const [time, expected] of [
  ['2026-09-15T22:00:00+08:00', '2026-09-15'],
  ['2026-09-15T23:59:59+08:00', '2026-09-15'],
  ['2026-09-16T00:00:00+08:00', '2026-09-15'],
  ['2026-09-16T07:59:59+08:00', '2026-09-15'],
  ['2026-09-16T08:00:00+08:00', '2026-09-16'],
  ['2026-10-01T03:00:00+08:00', '2026-09-30'],
  ['2027-01-01T03:00:00+08:00', '2026-12-31'],
]) {
  test(`night business date at ${time}`, () => assert.equal(dispatchBusinessDate('夜', Date.parse(time)), expected))
}

for (const shift of ['早', '晚']) {
  test(`${shift} retains calendar date before 08:00`, () => {
    assert.equal(dispatchBusinessDate(shift, Date.parse('2026-09-16T03:00:00+08:00')), '2026-09-16')
  })
}

test('view defaults to night only between 22:00 and 08:00', () => {
  for (const [hour, expected] of [['21:59:59', '早'], ['22:00:00', '夜'], ['07:59:59', '夜'], ['08:00:00', '早']]) {
    const now = Date.parse(`2026-09-16T${hour}+08:00`)
    assert.equal(initialDispatchShift(now), expected)
    assert.equal(isDispatchNightWindow(now), expected === '夜')
  }
})

test('date is calculated from the clock, never repeatedly subtracted from selection', () => {
  const now = Date.parse('2026-09-16T02:30:00+08:00')
  for (let i = 0; i < 10; i++) assert.equal(dispatchBusinessDate('夜', now), '2026-09-15')
})
