'use strict'
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { defineString } = require('firebase-functions/params')
const { hashToken, millis, parseTaipei, targetMatches, canClaim } = require('./broadcast-push-domain')
const vapidKey = defineString('FCM_WEB_VAPID_KEY', { default: '' })
const appUrl = defineString('PUSH_APP_URL', { default: 'https://pop-mart-1027.github.io/dispatch-schedule-beta/' })

// All mutations use Admin SDK after checking the existing Authentication + employees.
module.exports = function registerPush({ db, requireUser, requireAdmin, messaging = getMessaging }) {
  async function pushUser(request) {
    const user = await requireUser(request)
    if (user.snapshot.data().mustChangePassword || request.auth.token.mustChangePassword) throw new HttpsError('failed-precondition', '請先修改密碼')
    return user
  }
  async function enabled() {
    return (await db.doc('systemSettings/features').get()).data()?.broadcastsEnabled !== false
  }
  const getWebPushConfig = onCall(async request => {
    await pushUser(request)
    return { vapidKey: vapidKey.value(), canRegisterPush: true }
  })
  const registerWebPushToken = onCall(async request => {
    const { employeeId } = await pushUser(request)
    const { token, deviceId, platform } = request.data || {}
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || typeof deviceId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(deviceId) || !['ios', 'android', 'desktop'].includes(platform)) throw new HttpsError('invalid-argument', '裝置資料格式不正確')
    const ref = db.doc(`pushTokens/${hashToken(token)}`)
    await ref.set({ token, employeeId, deviceId, platform, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    // Token rotation: remove only this employee's older tokens for this installation.
    const old = await db.collection('pushTokens').where('employeeId', '==', employeeId).get()
    await Promise.all(old.docs.filter(d => d.id !== ref.id && d.data().deviceId === deviceId).map(d => d.ref.delete()))
    return { registered: true }
  })
  const unregisterWebPushToken = onCall(async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', '請先登入')
    const token = request.data?.token
    if (typeof token !== 'string' || token.length > 4096) throw new HttpsError('invalid-argument', 'token 格式不正確')
    const ref = db.doc(`pushTokens/${hashToken(token)}`)
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (snap.data()?.employeeId === (request.auth.token.employeeId || request.auth.uid)) tx.delete(ref)
    })
    return { removed: true }
  })
  const scheduleBroadcastPush = onCall(async request => {
    const actor = await requireAdmin(request)
    if (!(await enabled())) throw new HttpsError('failed-precondition', '廣播功能尚未開啟')
    const { broadcastId, mode, scheduledAt } = request.data || {}
    if (typeof broadcastId !== 'string' || !broadcastId || broadcastId.includes('/') || !['now', 'scheduled', 'cancel'].includes(mode)) throw new HttpsError('invalid-argument', '推播設定不正確')
    let sendAt = new Date()
    if (mode === 'scheduled') {
      try { sendAt = parseTaipei(scheduledAt) } catch (error) { throw new HttpsError('invalid-argument', error.message) }
    }
    await db.runTransaction(async tx => {
      const ref = db.doc(`broadcasts/${broadcastId}`)
      const snap = await tx.get(ref), b = snap.data()
      if (!b) throw new HttpsError('not-found', '找不到廣播')
      if (b.push && !['pending', 'cancelled'].includes(b.push.status)) throw new HttpsError('failed-precondition', '此廣播已開始推播，不可重複發送')
      if (mode !== 'cancel' && (!b.active || !b.title?.trim() || !b.content?.trim() || !['all', 'morning', 'night', 'area', 'employee'].includes(b.targetType) || (['area', 'employee'].includes(b.targetType) && !b.targetValues?.length))) throw new HttpsError('failed-precondition', '請先儲存有效、啟用且已指定對象的廣播')
      if (mode !== 'cancel' && ((millis(b.startAt) && millis(b.startAt) > +sendAt) || (millis(b.endAt) && millis(b.endAt) <= +sendAt))) throw new HttpsError('failed-precondition', '推播時間必須位於廣播顯示期間內')
      tx.update(ref, { push: { status: mode === 'cancel' ? 'cancelled' : 'pending', sendAt: Timestamp.fromDate(sendAt), requestedBy: actor.employeeId, requestedAt: Timestamp.now(), timezone: 'Asia/Taipei' } })
    })
    return { queued: mode !== 'cancel' }
  })

  async function dispatch(ref) {
    if (!(await enabled())) return
    // Atomic, permanent claim BEFORE contacting FCM. Never resend ambiguous attempts.
    const b = await db.runTransaction(async tx => {
      const snap = await tx.get(ref), value = snap.data()
      if (!canClaim(value, Date.now())) return null
      if (!value.active || millis(value.startAt) > Date.now() || (millis(value.endAt) && millis(value.endAt) < Date.now())) {
        tx.update(ref, { 'push.status': 'cancelled', 'push.reason': 'inactive-or-expired' }); return null
      }
      tx.update(ref, { 'push.status': 'sending', 'push.claimedAt': Timestamp.now() })
      return value
    })
    if (!b) return
    let accepted = 0, failed = 0, invalid = 0
    try {
      const month = new Date(millis(b.push.sendAt) + 28800000).toISOString().slice(0, 7)
      const [tokens, employees, schedules, layout] = await Promise.all([
        db.collection('pushTokens').get(), db.collection('employees').where('active', '==', true).get(),
        db.collection('scheduleRecords').where('date', '>=', `${month}-01`).where('date', '<=', `${month}-31`).get(),
        db.doc(`scheduleMonthLayouts/${month}`).get(),
      ])
      const { eligibleMonthSchedules } = await import('./month-schedule-policy.mjs')
      const records = eligibleMonthSchedules(schedules.docs.map(d => d.data()), layout.data())
      const active = new Set(employees.docs.filter(d => !d.data().mustChangePassword).map(d => d.id))
      const targets = tokens.docs.filter(d => active.has(d.data().employeeId) && targetMatches(b, d.data().employeeId, records.filter(r => r.employeeId === d.data().employeeId)))
      const url = new URL(appUrl.value()); if (url.protocol !== 'https:') throw new Error('PUSH_APP_URL must use HTTPS')
      url.searchParams.set('page', 'broadcasts'); url.searchParams.set('broadcastId', ref.id)
      for (let offset = 0; offset < targets.length; offset += 100) {
        const group = targets.slice(offset, offset + 100)
        // Each ledger entry is private; no change to broadcastReads.
        const batch = db.batch()
        for (const d of group) batch.create(ref.collection('pushDeliveries').doc(d.id), { employeeId: d.data().employeeId, status: 'attempted', attemptedAt: Timestamp.now() })
        await batch.commit()
        const result = await messaging().sendEachForMulticast({
          tokens: group.map(d => d.data().token),
          data: { broadcastId: ref.id, title: b.title.slice(0, 80), body: b.content.slice(0, 500), url: url.href },
          webpush: { headers: { TTL: String(Math.max(0, Math.min(3600, Math.floor(((millis(b.endAt) || Date.now() + 3600000) - Date.now()) / 1000)))), Urgency: 'high' } },
        })
        await Promise.all(result.responses.map(async (response, i) => {
          const d = group[i], code = response.error?.code || ''
          if (response.success) accepted++; else failed++
          await ref.collection('pushDeliveries').doc(d.id).update({ status: response.success ? 'accepted' : 'failed', code, completedAt: Timestamp.now() })
          if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument', 'messaging/registration-token-expired'].includes(code)) {
            invalid++
            await db.runTransaction(async tx => {
              const latest = await tx.get(d.ref)
              if (latest.data()?.token === d.data().token && latest.data()?.employeeId === d.data().employeeId) tx.delete(d.ref)
            })
          }
        }))
      }
      await ref.update({ 'push.status': failed ? 'partial' : 'sent', 'push.accepted': accepted, 'push.failed': failed, 'push.invalid': invalid, 'push.finishedAt': Timestamp.now() })
    } catch (error) {
      console.error('broadcast push failed', ref.id, error.code || error.name)
      await ref.update({ 'push.status': 'uncertain', 'push.accepted': accepted, 'push.failed': failed, 'push.finishedAt': Timestamp.now() })
    }
  }
  const onBroadcastPushQueued = onDocumentWritten({ document: 'broadcasts/{broadcastId}', timeoutSeconds: 540 }, event => dispatch(event.data.after.ref))
  const sendScheduledBroadcastPushes = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Taipei', timeoutSeconds: 540 }, async () => {
    const pending = await db.collection('broadcasts').where('push.status', '==', 'pending').get()
    for (const doc of pending.docs) if (canClaim(doc.data(), Date.now())) await dispatch(doc.ref)
    // A worker killed after its claim must not silently look successful or retry.
    const sending = await db.collection('broadcasts').where('push.status', '==', 'sending').get()
    for (const doc of sending.docs) if (millis(doc.data().push.claimedAt) < Date.now() - 15 * 60000) await db.runTransaction(async tx => {
      const latest = await tx.get(doc.ref)
      if (latest.data()?.push?.status === 'sending') tx.update(doc.ref, { 'push.status': 'uncertain', 'push.reason': 'worker-timeout' })
    })
  })
  return { getWebPushConfig, registerWebPushToken, unregisterWebPushToken, scheduleBroadcastPush, onBroadcastPushQueued, sendScheduledBroadcastPushes }
}
