'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { monitorOnDuty, taipeiDate, validMedia, MAX_FILE_BYTES } = require('./vehicle-fault-domain')

const monitor = { role: 'duty', title: '調度監控', active: true, mustChangePassword: false }
const at = time => Date.parse(`2026-09-15T${time}:00+08:00`)
const record = code => ({ date: '2026-09-15', scheduleCode: code })
for (const [label, code, now, expected] of [
  ['early before start', '早監', at('06:59'), false],
  ['early inclusive start', '早監', at('07:00'), true],
  ['early exclusive end', '早監', at('17:00'), false],
  ['late before start', '晚監', at('11:59'), false],
  ['late inclusive start', '晚監', at('12:00'), true],
  ['late exclusive end', '晚監', at('21:00'), false],
  ['night inclusive start', '夜監', at('21:00'), true],
  ['night after midnight', '夜監', Date.parse('2026-09-16T06:59:00+08:00'), true],
  ['night exclusive end', '夜監', Date.parse('2026-09-16T07:00:00+08:00'), false],
  ['rest', '休', at('12:00'), false],
  ['leave', '早監請假', at('12:00'), false],
  ['empty', '', at('12:00'), false],
]) test(label, () => assert.equal(monitorOnDuty(record(code), monitor, now), expected))
test('overlapping early and late monitors both match', () => {
  assert.equal(monitorOnDuty(record('早監'), monitor, at('13:00')), true)
  assert.equal(monitorOnDuty(record('晚監'), monitor, at('13:00')), true)
})
test('disabled, password-pending and non-duty employees cannot receive monitor push', () => {
  for (const patch of [{ active: false }, { mustChangePassword: true }, { role: 'employee' }]) assert.equal(monitorOnDuty(record('早監'), { ...monitor, ...patch }, at('10:00')), false)
})
test('media validates bytes and payload budget', () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  assert.equal(validMedia(png, 'image/png'), true)
  assert.equal(validMedia(png, 'image/jpeg'), false)
  assert.equal(validMedia(Buffer.from('<svg onload="alert(1)">'), 'image/svg+xml'), false)
  assert.equal(validMedia(Buffer.alloc(MAX_FILE_BYTES + 1), 'image/png'), false)
  assert.ok(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 1024 < 10 * 1024 * 1024)
})

// Hard safety guard: these integration tests may only use an emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Run with Firestore emulator and GCLOUD_PROJECT=demo-smilebike-vehicle')
const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore(app)
const fileStore = new Map()
const sent = []
let messagingFailure = false
const storage = () => ({ bucket: () => ({ file: key => ({
  save: async bytes => { if (fileStore.has(key)) throw Object.assign(new Error('exists'), { code: 412 }); fileStore.set(key, Buffer.from(bytes)) },
  download: async () => { if (!fileStore.has(key)) throw new Error('missing'); return [fileStore.get(key)] },
}) }) })
const messaging = () => ({ sendEachForMulticast: async payload => {
  sent.push(payload)
  if (messagingFailure) throw Object.assign(new Error('simulated transport failure'), { code: 'messaging/server-unavailable' })
  return { successCount: payload.tokens.length, failureCount: 0, responses: payload.tokens.map(() => ({ success: true })) }
} })
async function requireUser(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'login required')
  const employeeId = request.auth.token.employeeId || request.auth.uid
  const snapshot = await db.doc(`employees/${employeeId}`).get()
  if (!snapshot.exists || snapshot.data().active !== true) throw new HttpsError('permission-denied', 'inactive')
  return { employeeId, snapshot }
}
const api = require('./vehicle-fault-service')({ db, requireUser, storage, messaging })
const roles = { E001: 'employee', E002: 'employee', M001: 'duty', M002: 'duty', F001: 'duty', A001: 'admin' }
function call(employeeId, action, data = {}, claims = {}) {
  return api.vehicleFault.run({ auth: { uid: employeeId, token: { employeeId, role: roles[employeeId], mustChangePassword: false, ...claims } }, data: { action, ...data } })
}
async function draft(employeeId = 'E001', attachmentCount = 0) {
  return call(employeeId, 'draft', { requestId: randomUUID(), vehicleNo: 'TEST-001', faultType: '其他故障', description: 'Emulator-only vehicle report', attachmentCount })
}
async function publish(employeeId = 'E001') {
  const d = await draft(employeeId)
  await call(employeeId, 'publish', { draftId: d.draftId })
  return d.reportId
}
before(async () => {
  for (const [employeeId, role] of Object.entries(roles)) await db.doc(`employees/${employeeId}`).set({ employeeId, role, name: `Test ${employeeId}`, title: employeeId === 'F001' ? '車管' : role === 'duty' ? '調度監控' : '測試', active: true, mustChangePassword: false })
  for (const date of [taipeiDate(Date.now()), taipeiDate(Date.now() - 86400000)]) await db.doc(`scheduleRecords/${date}_M001`).set({ date, employeeId: 'M001', scheduleCode: '早晚夜監' })
  for (const [name, employeeId, patch] of [['valid1', 'M001', {}], ['valid2', 'M001', {}], ['disabled', 'M001', { enabled: false }], ['invalid', 'M001', { status: 'invalid' }], ['other', 'E002', {}]]) await db.doc(`pushTokens/${name}`).set({ employeeId, token: `fake-emulator-token-${name}-never-send`, ...patch })
})
after(async () => { await db.terminate(); await deleteApp(app) })

test('callables load and reject unauthenticated calls', async () => {
  assert.equal(typeof api.vehicleFault.run, 'function')
  assert.equal(typeof api.onVehicleFaultReported.run, 'function')
  await assert.rejects(api.vehicleFault.run({ data: { action: 'capabilities' } }), { code: 'unauthenticated' })
})
test('fleet requires both duty role and fleet title; forged admin claims do not elevate', async () => {
  assert.equal((await call('F001', 'capabilities')).fleet, true)
  assert.equal((await call('M001', 'capabilities')).fleet, false)
  assert.equal((await call('E001', 'capabilities', {}, { role: 'admin' })).fleet, false)
  await assert.rejects(call('E001', 'list', { lane: 'fleet' }), { code: 'permission-denied' })
  await assert.rejects(call('M001', 'list', { lane: 'fleet' }), { code: 'permission-denied' })
  await assert.rejects(call('E001', 'capabilities', {}, { mustChangePassword: true }), { code: 'permission-denied' })
})
test('reporter is server-derived and repeated publish does not duplicate reports', async () => {
  const d = await draft()
  const first = await call('E001', 'publish', { draftId: d.draftId, reporterId: 'A001', reporterName: 'forged' })
  const again = await call('E001', 'publish', { draftId: d.draftId })
  assert.equal(first.reportId, again.reportId)
  const r = (await db.doc(`vehicleFaultReports/${d.reportId}`).get()).data()
  assert.equal(r.reporterId, 'E001'); assert.equal(r.reporterName, 'Test E001')
  assert.deepEqual(r.monitorIds, ['M001']); assert.equal(r.routingStatus, 'resolved')
  assert.equal(r.priority, 'unassessed'); assert.equal(r.status, 'pending')
})
test('own report privacy applies to listing, detail, drafts and attachments', async () => {
  const d = await draft('E002')
  await call('E002', 'publish', { draftId: d.draftId })
  const list = await call('E001', 'list', { lane: 'employee' })
  assert.ok(!list.reports.some(r => r.id === d.reportId))
  await assert.rejects(call('E001', 'detail', { reportId: d.reportId, lane: 'employee' }), { code: 'permission-denied' })
  await assert.rejects(call('E001', 'attachment', { reportId: d.reportId, index: 0 }), { code: 'permission-denied' })
  await assert.rejects(call('E001', 'publish', { draftId: d.draftId }), { code: 'permission-denied' })
})
test('monitor and fleet read receipts are independent, including the same administrator', async () => {
  const reportId = await publish()
  await call('A001', 'detail', { reportId, lane: 'monitor' })
  let fleet = await call('A001', 'list', { lane: 'fleet' })
  assert.equal(fleet.reports.find(r => r.id === reportId).unread, true)
  await call('A001', 'detail', { reportId, lane: 'fleet' })
  fleet = await call('A001', 'list', { lane: 'fleet' })
  assert.equal(fleet.reports.find(r => r.id === reportId).unread, false)
  assert.equal(fleet.reports.find(r => r.id === reportId).status, 'pending')
})
test('monitor triage and fleet take/complete enforce role, version and completion notes', async () => {
  const reportId = await publish()
  await assert.rejects(call('E001', 'triage', { reportId, version: 1, priority: 'urgent' }), { code: 'permission-denied' })
  await call('M001', 'triage', { reportId, version: 1, priority: 'urgent', note: 'Stop driving' })
  await assert.rejects(call('M001', 'start', { reportId, version: 2 }), { code: 'permission-denied' })
  await assert.rejects(call('F001', 'start', { reportId, version: 1 }), { code: 'aborted' })
  await call('F001', 'start', { reportId, version: 2 })
  await assert.rejects(call('F001', 'complete', { reportId, version: 3, note: '' }), { code: 'invalid-argument' })
  await call('F001', 'complete', { reportId, version: 3, note: 'Emulator repair complete' })
  const result = await call('E001', 'detail', { reportId, lane: 'employee' })
  assert.equal(result.report.status, 'completed'); assert.equal(result.events.length, 4)
  await assert.rejects(call('F001', 'start', { reportId, version: 4 }), { code: 'failed-precondition' })
})
test('attachments require completion before publish and stay private', async () => {
  const d = await draft('E001', 1)
  await assert.rejects(call('E001', 'publish', { draftId: d.draftId }), { code: 'failed-precondition' })
  const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  await call('E001', 'upload', { draftId: d.draftId, index: 0, mime: 'image/png', base64: bytes.toString('base64') })
  await call('E001', 'upload', { draftId: d.draftId, index: 0, mime: 'image/png', base64: bytes.toString('base64') })
  await call('E001', 'publish', { draftId: d.draftId })
  const media = await call('F001', 'attachment', { reportId: d.reportId, index: 0 })
  assert.equal(media.base64, bytes.toString('base64'))
  const detail = await call('E001', 'detail', { reportId: d.reportId, lane: 'employee' })
  assert.equal(detail.report.attachments[0].key, undefined)
  await assert.rejects(call('E001', 'upload', { draftId: d.draftId, index: 0, mime: 'image/png', base64: bytes.toString('base64') }), { code: 'failed-precondition' })
})
test('event trigger sends only valid on-duty monitor tokens and claims only once', async () => {
  const reportId = await publish()
  const ref = db.doc(`vehicleFaultReports/${reportId}`)
  const event = { data: await ref.get(), params: { reportId } }
  const beforeCount = sent.length
  await api.onVehicleFaultReported.run(event)
  await api.onVehicleFaultReported.run(event)
  assert.equal(sent.length - beforeCount, 1)
  const r = (await ref.get()).data()
  assert.equal(r.notificationStatus, 'sent')
  assert.deepEqual(r.notificationResult, { targetTokenCount: 2, attemptedCount: 2, successCount: 2, failureCount: 0 })
  assert.equal(sent.at(-1).data.kind, 'vehicle-fault')
})
test('FCM exception keeps the report and is never blindly resent', async () => {
  const reportId = await publish()
  const ref = db.doc(`vehicleFaultReports/${reportId}`)
  const event = { data: await ref.get(), params: { reportId } }
  const beforeCount = sent.length
  messagingFailure = true
  try { await api.onVehicleFaultReported.run(event); await api.onVehicleFaultReported.run(event) } finally { messagingFailure = false }
  assert.equal(sent.length - beforeCount, 1)
  assert.equal((await ref.get()).data().notificationStatus, 'uncertain')
  assert.equal((await ref.get()).data().status, 'pending')
})
test('missing duty schedule retains an unrouted case without sending to everyone', async () => {
  for (const date of [taipeiDate(Date.now()), taipeiDate(Date.now() - 86400000)]) await db.doc(`scheduleRecords/${date}_M001`).update({ scheduleCode: '休' })
  const reportId = await publish()
  const ref = db.doc(`vehicleFaultReports/${reportId}`)
  const beforeCount = sent.length
  await api.onVehicleFaultReported.run({ data: await ref.get(), params: { reportId } })
  assert.equal(sent.length, beforeCount)
  assert.equal((await ref.get()).data().notificationStatus, 'unrouted')
  assert.ok((await call('M001', 'list', { lane: 'unrouted' })).reports.some(r => r.id === reportId))
})
