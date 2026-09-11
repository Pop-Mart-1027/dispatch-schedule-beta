'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { importGoogleDispatch } = require('./dispatch-google-import')
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }

function setup({ mismatched = false, failCommit = false, wrongNightSheet = false } = {}) {
  let sequence = 0
  const saved = new Map([
    ['dispatchBlocks/2026-09-09_day_single_2', { date: '2026-09-09', vehicleNo: 'OLD-1111', drivers: [{ employeeId: 'old', employeeName: '原駕駛' }], modifiedBy: 'manual', createdAt: 'original-time' }],
    ['dispatchBlocks/old-block', { date: '2026-09-09', status: 'active', drivers: [] }],
    ['dispatchBlocks/other-date', { date: '2026-09-08', vehicleNo: 'HISTORY', status: 'active' }],
  ])
  const employees = [{ id: 'E1', data: () => ({ name: '張大同' }) }, { id: 'E2', data: () => ({ name: '王小明' }) }]
  const db = {
    collection(name) { return {
      name, where(field, operator, value) { return { name, field, value, get: async () => ({ docs: employees }) } },
      doc(id = `auto-${sequence++}`) { return { path: `${name}/${id}` } },
    } },
    async runTransaction(callback) {
      const writes = []
      await callback({
        get: async query => ({ docs: [...saved].filter(([key, value]) => key.startsWith(`${query.name}/`) && value.date === query.value).map(([key, value]) => ({ id: key.split('/')[1], ref: { path: key }, data: () => value })) }),
        set: (ref, data) => writes.push([ref.path, data]),
        update: (ref, data) => writes.push([ref.path, { ...saved.get(ref.path), ...data }]),
      })
      if (failCommit) throw new Error('transaction failed')
      for (const [path, data] of writes) saved.set(path, data)
    },
  }
  const fetch = async url => {
    const night = decodeURIComponent(url).includes('大夜') && !wrongNightSheet
    return { ok: true, text: async () => night
      ? '9/9大夜派工單,,,,,,,,,\n藝文 O1區,RFW-7651,,,,,,板橋 O2區,RFX-6095,\n駕駛,隨車,工作重點,,,,,駕駛,駐點,工作重點\n張大同,王小明,夜班重點,,,,,,,\n'
      : `${mismatched ? '9月8日' : '9月9日'}\n府前 A1區,RFM-2661\n駕駛,駐點,工作重點\n張大同,王小明,日班重點\n` }
  }
  return { saved, options: { date: '2026-09-09', actorId: 'M1', db, fetch, HttpsError, FieldValue: { serverTimestamp: () => 'server-time' } } }
}

test('explicit Google import replaces people and vehicle data and retains all parsed roles', async () => {
  const { saved, options } = setup()
  const result = await importGoogleDispatch(options)
  assert.equal(result.dayBlocks, 1); assert.equal(result.nightBlocks, 2)
  const day = saved.get('dispatchBlocks/2026-09-09_day_single_2')
  assert.equal(day.vehicleNo, 'RFM-2661'); assert.equal(day.drivers[0].employeeName, '張大同')
  assert.equal(day.stations[0].employeeName, '王小明'); assert.equal(day.workFocus, '日班重點')
  assert.equal(day.modifiedBy, 'M1'); assert.equal(day.createdAt, 'original-time')
  assert.equal(saved.get('dispatchBlocks/2026-09-09_night_left_2').assistants[0].employeeName, '王小明')
  assert.equal(saved.get('dispatchBlocks/old-block').status, 'deleted')
  assert.equal(saved.get('dispatchBlocks/other-date').vehicleNo, 'HISTORY')
  const audits = [...saved].filter(([path]) => path.startsWith('dispatchAuditLogs/')).map(([, data]) => data)
  assert.equal(audits.length, 4)
  assert.ok(audits.some(item => item.before?.vehicleNo === 'OLD-1111' && item.after.vehicleNo === 'RFM-2661'))
})
test('wrong Google source date cannot overwrite the selected date', async () => {
  const { options, saved } = setup({ mismatched: true })
  await assert.rejects(importGoogleDispatch(options), error => error.code === 'failed-precondition')
  assert.equal(saved.size, 3)
})
test('failed import transaction leaves the whole original day intact', async () => {
  const { options, saved } = setup({ failCommit: true })
  await assert.rejects(importGoogleDispatch(options), /transaction failed/)
  assert.equal(saved.size, 3); assert.equal(saved.get('dispatchBlocks/2026-09-09_day_single_2').vehicleNo, 'OLD-1111')
})
test('missing night sheet cannot silently import the day sheet into night dispatch', async () => {
  const { options, saved } = setup({ wrongNightSheet: true })
  await assert.rejects(importGoogleDispatch(options), error => error.code === 'failed-precondition')
  assert.equal(saved.size, 3)
})

function handlers(profileRole = 'duty', env = {}) {
  const exports = {}; let imports = 0; let reads = 0
  const snapshot = { exists: true, data: () => ({ active: true, role: profileRole }) }
  const db = { collection: () => ({ doc: () => ({ get: async () => { reads++; return snapshot } }) }) }
  const fakeRequire = name => ({
    'firebase-admin/app': { initializeApp() {} }, 'firebase-admin/auth': { getAuth: () => ({}) },
    'firebase-admin/firestore': { FieldValue: {}, getFirestore: () => db },
    'firebase-functions/v2/https': { HttpsError, onRequest: (...args) => args.at(-1), onCall: (...args) => args.at(-1) },
    'firebase-functions/v2/options': { setGlobalOptions() {} },
    'firebase-functions/v2/scheduler': { onSchedule: (_options, callback) => callback },
    bcryptjs: {}, './dispatch-google-import': { importGoogleDispatch: async options => { imports++; return { date: options.date } } },
  })[name]
  vm.runInNewContext(fs.readFileSync(require.resolve('./index.js'), 'utf8'), { require: fakeRequire, exports, Buffer, process: { env }, fetch: () => { throw Error('unexpected fetch') } })
  return { exports, counts: () => ({ imports, reads }) }
}
test('scheduler performs no Google read or dispatch write', async () => {
  const { exports, counts } = handlers()
  assert.equal((await exports.syncCurrentDispatchBlocks({}, { status: () => ({ json: value => value }) })).disabled, true)
  assert.deepEqual(counts(), { imports: 0, reads: 0 })
})

test('migration close scheduler cannot touch data before explicit activation', async () => {
  for (const env of [{}, { CLOSE_PRE_SCHEDULE_ENABLED: 'false' }]) {
    const { exports, counts } = handlers('admin', env)
    assert.equal((await exports.closePreScheduleMonths()).disabled, true)
    assert.deepEqual(counts(), { imports: 0, reads: 0 })
  }
})
test('employee cannot import even when forging a confirmation', async () => {
  const { exports, counts } = handlers('employee')
  await assert.rejects(exports.syncDispatchBlocks({ auth: { uid: 'E1', token: { role: 'admin' } }, data: { confirmed: true, date: '2026-09-09' } }), error => error.code === 'permission-denied')
  assert.equal(counts().imports, 0)
})
test('monitor must explicitly confirm before any Google data is fetched', async () => {
  const { exports, counts } = handlers()
  await assert.rejects(exports.syncDispatchBlocks({ auth: { uid: 'M1', token: { role: 'duty' } }, data: { date: '2026-09-09' } }), error => error.code === 'failed-precondition')
  assert.equal(counts().imports, 0)
})
test('monitor and admin can explicitly import their selected date', async () => {
  for (const role of ['duty', 'admin']) {
    const { exports, counts } = handlers(role)
    await exports.syncDispatchBlocks({ auth: { uid: 'M1', token: { role } }, data: { date: '2026-09-09', confirmed: true } })
    assert.equal(counts().imports, 1)
  }
})
