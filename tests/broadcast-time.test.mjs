import test from 'node:test'
import assert from 'node:assert/strict'
import { broadcastIsActive, parseBroadcastDateTime } from '../lib/broadcast-time.mjs'

const taipeiNow = new Date('2026-09-11T12:00:00.000Z')

test('MM/DD HH:mm resolves in the current Asia/Taipei year', () => {
  const value = parseBroadcastDateTime('09/11 20:30', taipeiNow)
  assert.equal(value?.toISOString(), '2026-09-11T12:30:00.000Z')
})

test('blank start is immediate and blank end is permanent', () => {
  assert.equal(parseBroadcastDateTime('', taipeiNow), null)
  assert.equal(broadcastIsActive(null, null, taipeiNow), true)
  assert.equal(broadcastIsActive(null, new Date('2026-09-12T00:00:00Z'), taipeiNow), true)
  assert.equal(broadcastIsActive(new Date('2026-09-12T00:00:00Z'), null, taipeiNow), false)
})

test('future start and end boundaries control visibility', () => {
  const start = new Date('2026-09-11T13:00:00Z')
  const end = new Date('2026-09-11T14:00:00Z')
  assert.equal(broadcastIsActive(start, end, new Date('2026-09-11T12:59:59Z')), false)
  assert.equal(broadcastIsActive(start, end, new Date('2026-09-11T13:00:00Z')), true)
  assert.equal(broadcastIsActive(start, end, new Date('2026-09-11T14:00:01Z')), false)
})

test('January input in December is interpreted as next year', () => {
  const decemberNow = new Date('2026-12-20T04:00:00Z')
  const value = parseBroadcastDateTime('01/05 10:00', decemberNow)
  assert.equal(value?.toISOString(), '2027-01-05T02:00:00.000Z')
})

test('invalid dates are rejected and legacy full datetimes remain comparable', () => {
  assert.equal(parseBroadcastDateTime('02/30 10:00', taipeiNow), null)
  assert.equal(broadcastIsActive(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-12T00:00:00Z'), taipeiNow), true)
})

test('legacy popupMode remains compatible with the independent flag contract', () => {
  assert.equal(({ popupMode: 'always' }).popupMode, 'always')
  assert.equal(({ popupMode: 'none' }).popupMode, 'none')
  assert.equal(({ openAppPopup: true }).openAppPopup, true)
})
