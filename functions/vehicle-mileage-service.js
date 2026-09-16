'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { taipeiDate, weekStart, normalizePlate, dispatchPlates, odometer, activeInWeek } = require('./vehicle-mileage-domain')

// Called only after vehicleFault's existing active employee / claims checks.
// New collections are server-only; no Rules, Auth, Push or dispatch writes.
module.exports = function createMileageService({ db, now = Date.now }) {
  const registry = db.doc('vehicleMileageSettings/registry')
  const reports = db.collection('vehicleMileageReports')
  const stamp = () => FieldValue.serverTimestamp()
  const validate = fn => { try { return fn() } catch (e) { throw new HttpsError('invalid-argument', e.message) } }
  const fleetOnly = user => { if (!user.fleet) throw new HttpsError('permission-denied', '只有車管或管理員可以管理里程看板') }
  const currentWeek = () => weekStart(taipeiDate(now()))
  const selectedWeek = input => {
    const week = validate(() => weekStart(input.week || taipeiDate(now())))
    if (week > currentWeek()) throw new HttpsError('invalid-argument', '不能登記或查看尚未開始的週次')
    return week
  }
  const reportDTO = doc => {
    const r = doc.data()
    return { id: doc.id, vehicleNo: r.vehicleNo, week: r.week, mileage: r.mileage, reporterId: r.reporterId,
      reporterName: r.reporterName, version: r.version, createdAt: r.createdAt?.toDate?.().toISOString() || null,
      updatedAt: r.updatedAt?.toDate?.().toISOString() || null }
  }
  async function weekReports(week) {
    const result = await reports.where('week', '==', week).limit(501).get()
    if (result.size > 500) throw new HttpsError('resource-exhausted', '本週紀錄超過看板容量，請聯絡管理員；未截斷顯示')
    return result.docs
  }
  return { async handle(user, input) {
    const action = input.action.slice('mileage.'.length)
    if (action === 'mine') {
      const week = selectedWeek(input)
      const docs = await weekReports(week)
      return { week, employeeId: user.employeeId, name: user.name, reports: docs.filter(d => d.data().reporterId === user.employeeId).map(reportDTO) }
    }
    if (action === 'submit') {
      const vehicleNo = validate(() => normalizePlate(input.vehicleNo))
      const mileage = validate(() => odometer(input.mileage))
      const week = selectedWeek(input)
      const ref = reports.doc(`${week}_${vehicleNo}`)
      return db.runTransaction(async tx => {
        const [reg, old] = await Promise.all([tx.get(registry), tx.get(ref)])
        const vehicle = reg.data()?.vehicles?.[vehicleNo]
        if (!reg.data()?.initialized) throw new HttpsError('failed-precondition', '車號清單尚未初始化，請車管先開啟每週里程看板')
        if (!vehicle || !vehicle.active) throw new HttpsError('failed-precondition', '此車號尚未列入使用中清單，請確認車號或請車管新增')
        const prior = old.data()
        if (old.exists && prior.reporterId !== user.employeeId && !user.fleet) throw new HttpsError('already-exists', '此車本週已由其他人登記，請交由車管核對，未覆蓋原紀錄')
        if ((input.version || 0) !== (prior?.version || 0)) throw new HttpsError('aborted', '此車本週紀錄已變更，請重新整理後再登記')
        if (old.exists && prior.mileage === mileage) return { reportId: ref.id, unchanged: true }
        const version = (prior?.version || 0) + 1
        const record = { vehicleNo, week, mileage, reporterId: prior?.reporterId || user.employeeId,
          reporterName: prior?.reporterName || user.name, updatedBy: user.employeeId, updatedByName: user.name,
          version, updatedAt: stamp(), ...(old.exists ? {} : { createdAt: stamp() }) }
        tx.set(ref, record, { merge: true })
        tx.create(ref.collection('events').doc(String(version).padStart(8, '0')), {
          version, mileage, previousMileage: prior?.mileage ?? null, actorId: user.employeeId, actorName: user.name, createdAt: stamp(),
        })
        return { reportId: ref.id, version }
      })
    }
    fleetOnly(user)
    if (action === 'registry') {
      const snap = await registry.get()
      return { initialized: snap.data()?.initialized === true, vehicles: Object.values(snap.data()?.vehicles || {}).map(v => ({ vehicleNo: v.vehicleNo, active: v.active })) }
    }
    if (action === 'initialize') {
      const { plates, rejected } = validate(() => dispatchPlates(input.vehicleNos))
      if (!plates.length) throw new HttpsError('failed-precondition', '派工單沒有可辨識的車號，尚未建立名冊；請稍後重試或手動新增')
      return db.runTransaction(async tx => {
        const snap = await tx.get(registry)
        if (snap.data()?.initialized) return { initialized: true, alreadyInitialized: true, count: Object.keys(snap.data().vehicles || {}).length, rejected: [] }
        const vehicles = Object.fromEntries(plates.map(vehicleNo => [vehicleNo, { vehicleNo, active: true, periods: [{ from: currentWeek(), to: null }], addedBy: user.employeeId }]))
        tx.set(registry, { initialized: true, vehicles, initializedAt: stamp(), initializedBy: user.employeeId, updatedAt: stamp() })
        return { initialized: true, count: plates.length, rejected }
      })
    }
    if (action === 'vehicles.add' || action === 'vehicles.archive') {
      const vehicleNo = validate(() => normalizePlate(input.vehicleNo))
      return db.runTransaction(async tx => {
        const snap = await tx.get(registry)
        const data = snap.data() || {}
        const vehicles = { ...(data.vehicles || {}) }
        const previous = vehicles[vehicleNo]
        const adding = action === 'vehicles.add'
        if (adding && previous?.active) return { updated: false }
        if (!adding && !previous?.active) return { updated: false }
        if (adding && !previous && Object.keys(vehicles).length >= 500) throw new HttpsError('resource-exhausted', '車號清單已達 500 台上限')
        const periods = (previous?.periods || []).map(p => ({ ...p }))
        if (adding) {
          if (periods.length >= 100) throw new HttpsError('resource-exhausted', '此車號停用／啟用次數已達上限，請聯絡管理員')
          periods.push({ from: currentWeek(), to: null })
        } else if (periods.length) periods[periods.length - 1].to = currentWeek()
        vehicles[vehicleNo] = { vehicleNo, active: adding, periods, modifiedBy: user.employeeId }
        tx.set(registry, { ...data, initialized: true, vehicles, updatedAt: stamp() })
        tx.create(registry.collection('events').doc(), { action, vehicleNo, actorId: user.employeeId, createdAt: stamp() })
        return { updated: true }
      })
    }
    if (action === 'board') {
      const week = selectedWeek(input)
      const [reg, docs] = await Promise.all([registry.get(), weekReports(week)])
      const vehicles = reg.data()?.vehicles || {}
      const byPlate = new Map(docs.map(d => [d.data().vehicleNo, reportDTO(d)]))
      const reads = docs.length ? await db.getAll(...docs.map(d => d.ref.collection('reads').doc(user.employeeId))) : []
      const unread = new Map(docs.map((d, i) => [d.data().vehicleNo, (reads[i]?.data()?.version || 0) < d.data().version]))
      const plates = new Set([...Object.values(vehicles).filter(v => activeInWeek(v, week)).map(v => v.vehicleNo), ...byPlate.keys()])
      const rows = [...plates].map(vehicleNo => ({ vehicleNo, active: vehicles[vehicleNo]?.active === true, report: byPlate.get(vehicleNo) || null, unread: unread.get(vehicleNo) || false }))
      rows.sort((a, b) => Number(!!a.report) - Number(!!b.report) || a.vehicleNo.localeCompare(b.vehicleNo))
      return { week, initialized: reg.data()?.initialized === true, rows }
    }
    if (action === 'history' || action === 'read') {
      const vehicleNo = validate(() => normalizePlate(input.vehicleNo))
      const ref = reports.doc(`${selectedWeek(input)}_${vehicleNo}`)
      if (action === 'read') {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref)
          if (!snap.exists || !Number.isInteger(input.version) || input.version < 1 || input.version > snap.data().version) throw new HttpsError('aborted', '紀錄已變更，請重新開啟')
          const receipt = ref.collection('reads').doc(user.employeeId)
          const previous = await tx.get(receipt)
          tx.set(receipt, { version: Math.max(previous.data()?.version || 0, input.version), readAt: stamp() })
        })
        return { read: true }
      }
      const [snap, events] = await Promise.all([ref.get(), ref.collection('events').orderBy('version', 'desc').limit(50).get()])
      if (!snap.exists) throw new HttpsError('not-found', '此車本週尚未登記')
      return { report: reportDTO(snap), events: events.docs.map(d => ({ version: d.data().version, mileage: d.data().mileage, previousMileage: d.data().previousMileage, actorName: d.data().actorName, createdAt: d.data().createdAt?.toDate?.().toISOString() || null })) }
    }
    throw new HttpsError('invalid-argument', '不支援的里程操作')
  } }
}
