'use strict'

const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const { taipeiDate, weekStart, normalizePlate, dispatchPlates, odometer, activeInWeek } = require('./vehicle-mileage-domain')

test('Taipei week uses Monday, including Friday and year boundaries', () => {
  assert.equal(taipeiDate(Date.parse('2026-09-17T17:00:00Z')), '2026-09-18')
  assert.equal(weekStart('2026-09-18'), '2026-09-14')
  assert.equal(weekStart('2026-09-20'), '2026-09-14')
  assert.equal(weekStart('2026-09-21'), '2026-09-21')
  assert.equal(weekStart('2027-01-01'), '2026-12-28')
  assert.throws(() => weekStart('2026-02-31'))
})
test('plates normalize case, whitespace and fullwidth characters', () => {
  for (const value of ['rfw-7651', ' RFW - 7651 ', 'ＲＦＷ－７６５１', 'RFW7651']) assert.equal(normalizePlate(value), 'RFW-7651')
  assert.throws(() => normalizePlate('../../employees'))
})
test('dispatch combined cards split plates and deduplicate all shifts', () => {
  assert.deepEqual(dispatchPlates(['RFW-7651 / RFW-7652', 'rfw-7651', 'RFW-7652、ABC-1234', '待安排', '']).plates, ['ABC-1234', 'RFW-7651', 'RFW-7652'])
  assert.deepEqual(dispatchPlates(['未知車號']).rejected, ['未知車號'])
})
test('odometer accepts zero and rejects negative, fractional and unsafe values', () => {
  assert.equal(odometer(0), 0)
  assert.equal(odometer(3500), 3500)
  for (const value of [-1, 0.1, NaN, Infinity, '3500', 10000000]) assert.throws(() => odometer(value))
})
test('registry activity is week-scoped and supports reactivation', () => {
  const vehicle = { periods: [{ from: '2026-09-14', to: '2026-09-21' }, { from: '2026-09-28', to: null }] }
  assert.equal(activeInWeek(vehicle, '2026-09-07'), false)
  assert.equal(activeInWeek(vehicle, '2026-09-14'), true)
  assert.equal(activeInWeek(vehicle, '2026-09-21'), false)
  assert.equal(activeInWeek(vehicle, '2026-09-28'), true)
})

const emulator = process.env.FIRESTORE_EMULATOR_HOST
if (emulator) {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(emulator)) throw new Error('Local emulator required')
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'demo-vehicle-mileage' }, 'vehicle-mileage-tests')
  const db = getFirestore(app)
  let clock = Date.parse('2026-09-18T10:00:00+08:00')
  const service = require('./vehicle-mileage-service')({ db, now: () => clock })
  const employee = { employeeId: 'T1000', name: 'Test Employee', fleet: false }
  const second = { employeeId: 'T1001', name: 'Second Employee', fleet: false }
  const fleet = { employeeId: 'T2000', name: 'Test Fleet', fleet: true }
  const call = (user, action, data = {}) => service.handle(user, { action: `mileage.${action}`, ...data })
  before(async () => {
    for (const name of ['vehicleMileageSettings', 'vehicleMileageReports', 'employees']) {
      for (const doc of (await db.collection(name).get()).docs) await db.recursiveDelete(doc.ref)
    }
  })
  after(async () => { await db.terminate(); await deleteApp(app) })

  test('only fleet can initialize or manage/read fleet data', async () => {
    for (const action of ['registry', 'initialize', 'vehicles.add', 'vehicles.archive', 'board', 'history', 'read']) {
      await assert.rejects(call(employee, action), e => e.code === 'permission-denied')
    }
    const result = await call(fleet, 'initialize', { vehicleNos: ['RFW-7651 / RFW-7652', 'RFW-7651', 'ABC-1234'] })
    assert.equal(result.count, 3)
  })
  test('a blank first week shows all vehicles missing', async () => {
    const board = await call(fleet, 'board')
    assert.equal(board.rows.length, 3)
    assert.ok(board.rows.every(r => r.report === null))
  })
  test('employee report is recorded once with server identity and an unread inbox record', async () => {
    await call(employee, 'submit', { vehicleNo: 'rfw7651', mileage: 3500, reporterId: fleet.employeeId, reporterName: 'spoof' })
    const row = (await call(fleet, 'board')).rows.find(r => r.vehicleNo === 'RFW-7651')
    assert.equal(row.report.mileage, 3500)
    assert.equal(row.report.reporterId, employee.employeeId)
    assert.equal(row.report.reporterName, employee.name)
    assert.equal(row.unread, true)
    assert.equal((await db.collection('vehicleMileageReports').get()).size, 1)
  })
  test('employee cannot overwrite another employee or submit an unknown plate', async () => {
    await assert.rejects(call(second, 'submit', { vehicleNo: 'RFW-7651', mileage: 9999, version: 1 }), e => e.code === 'already-exists')
    await assert.rejects(call(employee, 'submit', { vehicleNo: 'ZZZ-9999', mileage: 1 }), e => e.code === 'failed-precondition')
  })
  test('own revision preserves previous mileage and rejects stale versions', async () => {
    await call(employee, 'submit', { vehicleNo: 'RFW-7651', mileage: 3550, version: 1 })
    await assert.rejects(call(employee, 'submit', { vehicleNo: 'RFW-7651', mileage: 3600, version: 1 }), e => e.code === 'aborted')
    const history = await call(fleet, 'history', { vehicleNo: 'RFW-7651' })
    assert.equal(history.events.length, 2)
    assert.equal(history.events[0].previousMileage, 3500)
  })
  test('concurrent registrations cannot create duplicates or silently overwrite', async () => {
    const results = await Promise.allSettled([call(employee, 'submit', { vehicleNo: 'RFW-7652', mileage: 1000 }), call(second, 'submit', { vehicleNo: 'RFW-7652', mileage: 2000 })])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  })
  test('read receipts never hide a newer correction', async () => {
    await call(fleet, 'read', { vehicleNo: 'RFW-7651', version: 2 })
    assert.equal((await call(fleet, 'board')).rows.find(r => r.vehicleNo === 'RFW-7651').unread, false)
    await call(fleet, 'submit', { vehicleNo: 'RFW-7651', mileage: 3600, version: 2 })
    await call(fleet, 'read', { vehicleNo: 'RFW-7651', version: 1 })
    const row = (await call(fleet, 'board')).rows.find(r => r.vehicleNo === 'RFW-7651')
    assert.equal(row.unread, true)
    assert.equal(row.report.reporterId, employee.employeeId)
  })
  test('mine never exposes another employee report', async () => {
    const result = await call(second, 'mine')
    assert.ok(result.reports.every(r => r.reporterId === second.employeeId))
  })
  test('archive preserves history and initial import cannot resurrect a removed vehicle', async () => {
    await call(fleet, 'vehicles.archive', { vehicleNo: 'RFW-7651' })
    await call(fleet, 'initialize', { vehicleNos: ['RFW-7651', 'NEW-9999'] })
    const registry = await call(fleet, 'registry')
    assert.equal(registry.vehicles.find(v => v.vehicleNo === 'RFW-7651').active, false)
    assert.equal(registry.vehicles.some(v => v.vehicleNo === 'NEW-9999'), false)
    assert.equal((await call(fleet, 'history', { vehicleNo: 'RFW-7651' })).events.length, 3)
    await assert.rejects(call(employee, 'submit', { vehicleNo: 'RFW-7651', mileage: 3700, version: 3 }), e => e.code === 'failed-precondition')
  })
  test('manual additions appear and zero mileage counts as registered', async () => {
    await call(fleet, 'vehicles.add', { vehicleNo: 'NEW-9999' })
    await call(employee, 'submit', { vehicleNo: 'NEW-9999', mileage: 0 })
    assert.equal((await call(fleet, 'board')).rows.find(r => r.vehicleNo === 'NEW-9999').report.mileage, 0)
  })
  test('new week resets status without deleting past records; no future submissions', async () => {
    clock = Date.parse('2026-09-25T10:00:00+08:00')
    const board = await call(fleet, 'board')
    assert.equal(board.rows.length, 3)
    assert.ok(board.rows.every(r => r.report === null))
    assert.equal((await call(fleet, 'history', { week: '2026-09-18', vehicleNo: 'RFW-7651' })).report.mileage, 3600)
    await assert.rejects(call(employee, 'submit', { week: '2026-09-28', vehicleNo: 'NEW-9999', mileage: 10 }), e => e.code === 'invalid-argument')
  })
  test('callable requires real claims and active profile; duty alone cannot manage fleet', async () => {
    const { HttpsError } = require('firebase-functions/v2/https')
    const requireUser = async request => {
      if (!request.auth) throw new HttpsError('unauthenticated', 'login')
      const employeeId = request.auth.token.employeeId
      const snapshot = await db.doc(`employees/${employeeId}`).get()
      if (!snapshot.exists || !snapshot.data().active) throw new HttpsError('permission-denied', 'inactive')
      return { employeeId, snapshot }
    }
    const { vehicleFault } = require('./vehicle-fault-service')({ db, requireUser })
    await db.doc('employees/T3000').set({ name: 'Duty', active: true, role: 'duty', title: '監控', mustChangePassword: false })
    const request = { auth: { uid: 'T3000', token: { employeeId: 'T3000', role: 'duty', mustChangePassword: false } }, data: { action: 'mileage.board' } }
    await assert.rejects(vehicleFault.run({ data: request.data }), e => e.code === 'unauthenticated')
    await assert.rejects(vehicleFault.run(request), e => e.code === 'permission-denied')
    await db.doc('employees/T3000').update({ title: '車管' })
    assert.ok(Array.isArray((await vehicleFault.run(request)).rows))
    await db.doc('employees/T3000').update({ active: false })
    await assert.rejects(vehicleFault.run(request), e => e.code === 'permission-denied')
  })
  test('no dispatch, schedule, Push or notification collections were written', async () => {
    const names = (await db.listCollections()).map(c => c.id)
    assert.deepEqual(names.sort(), ['employees', 'vehicleMileageReports', 'vehicleMileageSettings'])
  })
} else {
  test('integration suite needs the local Firestore emulator', { skip: true }, () => {})
}
