'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { FieldValue, FieldPath } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { getMessaging } = require('firebase-admin/messaging')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { FAULT_TYPES, PRIORITIES, MAX_FILE_BYTES, taipeiDate, monitorOnDuty, validMedia } = require('./vehicle-fault-domain')

// No client Firestore access or public attachment URLs. Every operation checks
// the current employee document AND the signed-in claims, independently of UI.
module.exports = function registerVehicleFaults({ db, requireUser, storage = getStorage, messaging = getMessaging }) {
  const mileage = require('./vehicle-mileage-service')({ db })
  const reports = db.collection('vehicleFaultReports')
  const drafts = db.collection('vehicleFaultDrafts')
  const stamp = () => FieldValue.serverTimestamp()
  const text = (value, max, required = true) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpsError('invalid-argument', '欄位內容或長度不正確')
    return value.trim()
  }
  const id = value => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new HttpsError('invalid-argument', '通報編號不正確')
    return value
  }
  async function actor(request) {
    const user = await requireUser(request)
    const employee = user.snapshot.data()
    if (request.auth.token.mustChangePassword !== false || employee.mustChangePassword !== false) throw new HttpsError('permission-denied', '請先完成密碼設定')
    if (request.auth.token.employeeId !== user.employeeId) throw new HttpsError('permission-denied', '登入身分不一致，請重新登入')
    const admin = request.auth.token.role === 'admin' && employee.role === 'admin'
    const duty = ['duty', 'admin'].includes(request.auth.token.role) && ['duty', 'admin'].includes(employee.role)
    return { ...user, name: employee.name || user.employeeId, duty, admin, fleet: admin || (duty && employee.title === '車管') }
  }
  function canRead(user, report) { return report.reporterId === user.employeeId || user.duty }
  function laneFor(user, lane) {
    if (lane === 'employee') return lane
    if (lane === 'fleet' && user.fleet) return lane
    if (['monitor', 'unrouted'].includes(lane) && user.duty) return 'monitor'
    throw new HttpsError('permission-denied', '沒有此收件匣權限')
  }
  function dto(snapshot) {
    const r = snapshot.data()
    const iso = value => value?.toDate?.().toISOString() || null
    return {
      id: snapshot.id, vehicleNo: r.vehicleNo, faultType: r.faultType, description: r.description,
      reporterId: r.reporterId, reporterName: r.reporterName, status: r.status,
      priority: r.priority, version: r.version, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
      routingStatus: r.routingStatus, notificationStatus: r.notificationStatus,
      assigneeName: r.assigneeName || '', assigneeId: r.assigneeId || '',
      monitorNote: r.monitorNote || '', completionNote: r.completionNote || '',
      attachments: (r.attachments || []).map(({ mime, size }, index) => ({ index, mime, size })),
    }
  }
  async function recipients(now) {
    const dates = [taipeiDate(now), taipeiDate(now - 86400000)]
    const snapshots = await db.collection('scheduleRecords').where('date', 'in', dates).get()
    const { monthParticipation } = await import('./month-schedule-policy.mjs')
    const months = [...new Set(dates.map(date => date.slice(0, 7)))]
    const layouts = new Map()
    for (const month of months) layouts.set(month, (await db.doc(`scheduleMonthLayouts/${month}`).get()).data())
    const candidates = snapshots.docs.map(s => s.data()).filter(r => /^[A-Z0-9]{3,40}$/.test(r.employeeId || '') && monthParticipation(layouts.get(r.date.slice(0, 7)), r.employeeId, r.date))
    const ids = [...new Set(candidates.map(r => r.employeeId))]
    const profiles = new Map()
    for (let i = 0; i < ids.length; i += 100) {
      const people = await db.getAll(...ids.slice(i, i + 100).map(employeeId => db.doc(`employees/${employeeId}`)))
      for (const p of people) if (p.exists) profiles.set(p.id, p.data())
    }
    return [...new Set(candidates.filter(r => monitorOnDuty(r, profiles.get(r.employeeId), now)).map(r => r.employeeId))]
  }
  async function ownDraft(user, draftId) {
    const ref = drafts.doc(id(draftId))
    const snap = await ref.get()
    if (!snap.exists || snap.data().reporterId !== user.employeeId) throw new HttpsError('permission-denied', '無法存取此通報草稿')
    return { ref, data: snap.data() }
  }
  const bucket = () => storage().bucket('meimei-breakfast-order-vehicle-faults')

  const vehicleFault = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async request => {
    const user = await actor(request)
    const input = request.data || {}
    const action = input.action
    if (action === 'capabilities') return { duty: user.duty, fleet: user.fleet, admin: user.admin, employeeId: user.employeeId, name: user.name }
    if (typeof action === 'string' && action.startsWith('mileage.')) return mileage.handle(user, input)
    if (action === 'draft') {
      const requestId = id(input.requestId)
      const vehicleNo = text(input.vehicleNo, 20).toUpperCase()
      if (!/^[A-Z0-9\- ]{2,20}$/.test(vehicleNo)) throw new HttpsError('invalid-argument', '請輸入完整車牌號碼')
      if (!FAULT_TYPES.includes(input.faultType)) throw new HttpsError('invalid-argument', '請選擇故障類型')
      const description = text(input.description, 2000)
      if (!Number.isInteger(input.attachmentCount) || input.attachmentCount < 0 || input.attachmentCount > 5) throw new HttpsError('invalid-argument', '最多附上五個檔案')
      const fingerprint = createHash('sha256').update(JSON.stringify([vehicleNo, input.faultType, description, input.attachmentCount])).digest('hex')
      const draftId = `${user.employeeId}_${requestId}`
      return db.runTransaction(async tx => {
        const ref = drafts.doc(draftId)
        const old = await tx.get(ref)
        if (old.exists) {
          if (old.data().fingerprint !== fingerprint) throw new HttpsError('failed-precondition', '草稿已變更，請重新送出')
          return { draftId, reportId: old.data().reportId, published: old.data().published === true }
        }
        // Reverse-time IDs keep newest first using the default ascending name
        // index, including employee and array-contains inbox filters.
        const reportId = `${String(9999999999999 - Date.now()).padStart(13, '0')}_${user.employeeId}_${randomUUID()}`
        tx.create(ref, { reportId, reporterId: user.employeeId, reporterName: user.name, vehicleNo, faultType: input.faultType, description, attachmentCount: input.attachmentCount, fingerprint, files: {}, published: false, createdAt: stamp() })
        return { draftId, reportId, published: false }
      })
    }
    if (action === 'upload') {
      const draft = await ownDraft(user, input.draftId)
      if (draft.data.published) throw new HttpsError('failed-precondition', '通報已送出，不能替換附件')
      const index = input.index
      if (!Number.isInteger(index) || index < 0 || index >= draft.data.attachmentCount) throw new HttpsError('invalid-argument', '附件序號不正確')
      if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new HttpsError('invalid-argument', '附件過大或格式不正確')
      const bytes = Buffer.from(input.base64, 'base64')
      if (!validMedia(bytes, input.mime)) throw new HttpsError('invalid-argument', '支援 JPG、PNG、WebP 照片與 MP4、MOV、WebM 影片；每個檔案上限 6 MB')
      const hash = createHash('sha256').update(bytes).digest('hex')
      const key = `vehicle-fault-private/${draft.data.reportId}/${index}-${hash}`
      try {
        await bucket().file(key).save(bytes, { resumable: false, contentType: input.mime, metadata: { cacheControl: 'private, no-store' }, preconditionOpts: { ifGenerationMatch: 0 } })
      } catch (error) {
        if (Number(error.code) !== 412) {
          console.error('vehicleFaultAttachment', { stage: 'upload', code: String(error.code || 'unknown') })
          throw new HttpsError('unavailable', '附件尚未上傳成功。請重試，或移除附件後先通報；不會假裝已送出')
        }
      }
      await db.runTransaction(async tx => {
        const snap = await tx.get(draft.ref)
        if (!snap.exists || snap.data().published) throw new HttpsError('failed-precondition', '草稿狀態已變更')
        tx.update(draft.ref, { [`files.${index}`]: { key, mime: input.mime, size: bytes.length } })
      })
      return { uploaded: true }
    }
    if (action === 'publish') {
      const draft = await ownDraft(user, input.draftId)
      let monitorIds = []
      try { monitorIds = await recipients(Date.now()) } catch (error) {
        console.error('vehicleFaultRouting', { stage: 'schedule-read', code: String(error.code || 'unknown') })
      }
      return db.runTransaction(async tx => {
        const snap = await tx.get(draft.ref)
        const d = snap.data()
        const ref = reports.doc(d.reportId)
        const existing = await tx.get(ref)
        if (existing.exists) return { reportId: ref.id, routingStatus: existing.data().routingStatus }
        const attachments = Array.from({ length: d.attachmentCount }, (_, i) => d.files[String(i)])
        if (attachments.some(file => !file)) throw new HttpsError('failed-precondition', '附件尚未完成上傳，請重試送出')
        const routingStatus = monitorIds.length ? 'resolved' : 'unresolved'
        tx.create(ref, { reporterId: d.reporterId, reporterName: user.name, vehicleNo: d.vehicleNo, faultType: d.faultType, description: d.description, attachments, monitorIds, routingStatus, notificationStatus: 'queued', priority: 'unassessed', status: 'pending', version: 1, createdAt: stamp(), updatedAt: stamp() })
        tx.create(ref.collection('events').doc(), { action: 'submitted', actorId: user.employeeId, actorName: user.name, note: '已送出車輛故障通報', createdAt: stamp() })
        tx.update(draft.ref, { published: true })
        return { reportId: ref.id, routingStatus }
      })
    }
    if (action === 'list') {
      const lane = laneFor(user, input.lane)
      let q = reports
      if (lane === 'employee') q = q.where('reporterId', '==', user.employeeId)
      else if (input.lane === 'unrouted') q = q.where('routingStatus', '==', 'unresolved')
      else if (lane === 'monitor') q = q.where('monitorIds', 'array-contains', user.employeeId)
      q = q.orderBy(FieldPath.documentId(), 'asc')
      if (input.cursor) q = q.startAfter(id(input.cursor))
      const snapshot = await q.limit(31).get()
      const docs = snapshot.docs.slice(0, 30)
      const readMap = new Map()
      if (docs.length) {
        const reads = await db.getAll(...docs.map(s => s.ref.collection('reads').doc(`${lane}_${user.employeeId}`)))
        reads.forEach((r, index) => readMap.set(docs[index].id, r.data()?.version || 0))
      }
      return { reports: docs.map(s => ({ ...dto(s), unread: readMap.get(s.id) < s.data().version })), cursor: snapshot.size > 30 ? docs.at(-1).id : null }
    }
    if (action === 'detail' || action === 'attachment') {
      const ref = reports.doc(id(input.reportId))
      const snap = await ref.get()
      if (!snap.exists || !canRead(user, snap.data())) throw new HttpsError('permission-denied', '沒有此通報的存取權限')
      if (action === 'attachment') {
        if (!Number.isInteger(input.index) || input.index < 0) throw new HttpsError('invalid-argument', '附件序號不正確')
        const attachment = snap.data().attachments[input.index]
        if (!attachment || !attachment.key.startsWith(`vehicle-fault-private/${ref.id}/`)) throw new HttpsError('not-found', '附件不存在')
        const [bytes] = await bucket().file(attachment.key).download()
        return { mime: attachment.mime, base64: bytes.toString('base64') }
      }
      const lane = laneFor(user, input.lane)
      const events = await ref.collection('events').orderBy('createdAt', 'desc').limit(50).get()
      await ref.collection('reads').doc(`${lane}_${user.employeeId}`).set({ version: snap.data().version, readAt: stamp() })
      return { report: { ...dto(snap), unread: false }, events: events.docs.map(s => ({ id: s.id, action: s.data().action, actorName: s.data().actorName, note: s.data().note, createdAt: s.data().createdAt?.toDate().toISOString() || null })) }
    }
    if (action === 'triage' || action === 'start' || action === 'complete') {
      if (action === 'triage' ? !user.duty : !user.fleet) throw new HttpsError('permission-denied', '沒有此操作權限')
      const note = text(input.note || '', 2000, action === 'complete')
      if (action === 'triage' && !PRIORITIES.includes(input.priority)) throw new HttpsError('invalid-argument', '請選擇緊急程度')
      const ref = reports.doc(id(input.reportId))
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists) throw new HttpsError('not-found', '通報不存在')
        const r = snap.data()
        if (input.version !== r.version) throw new HttpsError('aborted', '其他人已更新此通報，請重新開啟後再操作')
        if (r.status === 'completed') throw new HttpsError('failed-precondition', '通報已結案')
        const update = { version: r.version + 1, updatedAt: stamp() }
        if (action === 'triage') Object.assign(update, { priority: input.priority, monitorNote: note, acknowledgedBy: user.employeeId, acknowledgedAt: stamp() })
        if (action === 'start') {
          if (r.status !== 'pending') throw new HttpsError('failed-precondition', '此通報已有人接手')
          Object.assign(update, { status: 'in_progress', assigneeId: user.employeeId, assigneeName: user.name, startedAt: stamp() })
        }
        if (action === 'complete') {
          if (r.status !== 'in_progress' || (!user.admin && r.assigneeId !== user.employeeId)) throw new HttpsError('permission-denied', '只能由接手車管或管理員完成案件')
          Object.assign(update, { status: 'completed', completionNote: note, completedAt: stamp() })
        }
        tx.update(ref, update)
        tx.create(ref.collection('events').doc(), { action, actorId: user.employeeId, actorName: user.name, note, ...(action === 'triage' ? { priority: input.priority } : {}), createdAt: stamp() })
      })
      return { updated: true }
    }
    throw new HttpsError('invalid-argument', '不支援的車輛通報操作')
  })

  // Independent from all six broadcast Functions. At-most-once FCM attempt:
  // uncertain delivery is retained for investigation, never blindly resent.
  const onVehicleFaultReported = onDocumentCreated({ document: 'vehicleFaultReports/{reportId}', retry: true, timeoutSeconds: 120 }, async event => {
    const ref = event.data?.ref
    if (!ref) return
    const claimed = await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (!snap.exists || snap.data().notificationStatus !== 'queued') return null
      tx.update(ref, { notificationStatus: 'sending', notificationClaimedAt: stamp() })
      return snap.data()
    })
    if (!claimed) return
    let stage = 'tokens', attemptedCount = 0, successCount = 0, failureCount = 0
    try {
      const tokens = new Map()
      for (const employeeId of claimed.monitorIds || []) {
        const employee = (await db.doc(`employees/${employeeId}`).get()).data()
        if (!employee || employee.active !== true || employee.mustChangePassword !== false || !['duty', 'admin'].includes(employee.role)) continue
        const snapshot = await db.collection('pushTokens').where('employeeId', '==', employeeId).get()
        for (const doc of snapshot.docs) {
          const t = doc.data()
          if (typeof t.token === 'string' && t.token.length >= 20 && t.active !== false && t.enabled !== false && !t.invalidAt && !['invalid', 'expired', 'disabled'].includes(t.status)) tokens.set(t.token, employeeId)
        }
      }
      const values = [...tokens.keys()]
      stage = 'fcm'
      for (let offset = 0; offset < values.length; offset += 500) {
        const chunk = values.slice(offset, offset + 500)
        attemptedCount += chunk.length
        const result = await messaging().sendEachForMulticast({ tokens: chunk, notification: { title: '車輛故障通報', body: `${claimed.vehicleNo} 有新的故障通報，請至後台收件匣確認。` }, data: { kind: 'vehicle-fault', reportId: ref.id }, webpush: { fcmOptions: { link: 'https://pop-mart-1027.github.io/dispatch-schedule-beta/#vehicle-inbox' } } })
        successCount += result.successCount
        failureCount += result.failureCount
        result.responses.forEach((response, index) => {
          if (!response.success) console.warn('vehicleFaultPushFailure', { reportId: ref.id, tokenFingerprint: createHash('sha256').update(chunk[index]).digest('hex').slice(0, 12), code: String(response.error?.code || 'unknown') })
        })
      }
      stage = 'result-write'
      const status = !values.length ? (claimed.monitorIds?.length ? 'no_tokens' : 'unrouted') : failureCount === 0 ? 'sent' : successCount === 0 ? 'failed' : 'partial'
      await ref.update({ notificationStatus: status, notificationFinishedAt: stamp(), notificationResult: { targetTokenCount: values.length, attemptedCount, successCount, failureCount } })
      console.info('vehicleFaultPushResult', { reportId: ref.id, status, targetTokenCount: values.length, attemptedCount, successCount, failureCount })
    } catch (error) {
      console.error('vehicleFaultPushError', { reportId: ref.id, stage, code: String(error.code || 'unknown'), attemptedCount, successCount, failureCount })
      await ref.update({ notificationStatus: 'uncertain', notificationErrorStage: stage, notificationFinishedAt: stamp() })
    }
  })
  return { vehicleFault, onVehicleFaultReported }
}
