'use strict'

const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { setGlobalOptions } = require('firebase-functions/v2/options')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const bcrypt = require('bcryptjs')
const { parseCsv, parseDay, parseNight } = require('./dispatch-block-parser')

initializeApp()
setGlobalOptions({ region: 'asia-east1', maxInstances: 10 })

const db = getFirestore()
const auth = getAuth()
const ROLES = new Set(['employee', 'duty', 'admin'])
const EMPLOYEE_ID = /^[A-Z0-9]{3,20}$/

function cleanId(value) {
  const id = String(value || '').trim().toUpperCase()
  if (!id || id.length > 40 || /[\/\u0000-\u001f]/.test(id)) throw new HttpsError('invalid-argument', '員工編號格式不正確')
  return id
}

function cleanText(value, field, max = 80) {
  const text = String(value || '').trim()
  if (!text || text.length > max) throw new HttpsError('invalid-argument', `${field}格式不正確`)
  return text
}

function cleanRole(value) {
  const role = String(value || '')
  if (!ROLES.has(role)) throw new HttpsError('invalid-argument', '權限角色不正確')
  return role
}

function employeeEmail(employeeId) {
  if (EMPLOYEE_ID.test(employeeId)) return `${employeeId.toLowerCase()}@employees.smilebike.invalid`
  return `id-${Buffer.from(employeeId, 'utf8').toString('hex')}@employees.smilebike.invalid`
}

async function importTemporaryPasswordUser({ employeeId, displayName, disabled = false, customClaims = {} }) {
  const passwordHash = Buffer.from(await bcrypt.hash(employeeId, 10))
  const result = await auth.importUsers([{
    uid: employeeId,
    email: employeeEmail(employeeId),
    emailVerified: true,
    displayName,
    disabled,
    passwordHash,
    customClaims,
  }], { hash: { algorithm: 'BCRYPT' } })
  if (result.failureCount) throw new HttpsError('internal', '暫時密碼帳號建立失敗')
}

function publicEmployee(doc) {
  const data = doc.data()
  return {
    employeeId: doc.id,
    name: data.name,
    title: data.title,
    role: data.role,
    hireDate: data.hireDate,
    active: data.active,
    mustChangePassword: data.mustChangePassword,
  }
}

async function audit(action, actorId, targetId, details = {}) {
  await db.collection('auditLogs').add({
    action,
    actorId,
    targetId,
    details,
    createdAt: FieldValue.serverTimestamp(),
  })
}

async function requireUser(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '請先登入')
  const employeeId = cleanId(request.auth.token.employeeId || request.auth.uid)
  const snapshot = await db.collection('employees').doc(employeeId).get()
  if (!snapshot.exists) throw new HttpsError('permission-denied', '找不到員工主檔')
  if (snapshot.data().active !== true) throw new HttpsError('permission-denied', '帳號已停用')
  return { employeeId, snapshot }
}

async function requireAdmin(request) {
  if (!request.auth || request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', '需要管理員權限')
  const employeeId = cleanId(request.auth.token.employeeId || request.auth.uid)
  const snapshot = await db.collection('employees').doc(employeeId).get()
  if (!snapshot.exists) throw new HttpsError('permission-denied', '找不到管理員主檔')
  const user = { employeeId, snapshot }
  if (snapshot.data().active !== true) throw new HttpsError('permission-denied', '帳號已停用')
  if (snapshot.data().mustChangePassword === true || request.auth.token.mustChangePassword === true) throw new HttpsError('failed-precondition', '請先修改密碼')
  if (user.snapshot.data().role !== 'admin') throw new HttpsError('permission-denied', '需要管理員權限')
  return user
}

async function requireDuty(request) {
  const user = await requireUser(request)
  if (!['duty', 'admin'].includes(user.snapshot.data().role)) throw new HttpsError('permission-denied', '需要值班監控權限')
  return user
}

exports.getMyProfile = onCall(async request => {
  const { employeeId, snapshot } = await requireUser(request)
  return publicEmployee(snapshot)
})

exports.changeOwnPassword = onCall(async request => {
  const { employeeId, snapshot } = await requireUser(request)
  const newPassword = String(request.data?.newPassword || '')
  if (newPassword.length < 8 || newPassword.length > 128) throw new HttpsError('invalid-argument', '新密碼至少需要 8 個字元')
  if (newPassword.toUpperCase() === employeeId) throw new HttpsError('invalid-argument', '新密碼不可與員工編號相同')
  await auth.updateUser(request.auth.uid, { password: newPassword })
  await snapshot.ref.update({ mustChangePassword: false, passwordChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await auth.setCustomUserClaims(request.auth.uid, { employeeId, role: snapshot.data().role, active: true, mustChangePassword: false })
  await auth.revokeRefreshTokens(request.auth.uid)
  await audit('password.changed', employeeId, employeeId)
  return { success: true }
})

exports.adminListEmployees = onCall(async request => {
  await requireAdmin(request)
  const snapshot = await db.collection('employees').orderBy('employeeId').get()
  return { employees: snapshot.docs.map(publicEmployee) }
})

exports.adminSaveEmployee = onCall(async request => {
  const actor = await requireAdmin(request)
  const input = request.data || {}
  const employeeId = cleanId(input.employeeId)
  const role = cleanRole(input.role)
  const record = {
    employeeId,
    name: cleanText(input.name, '姓名'),
    title: cleanText(input.title, '職稱'),
    hireDate: cleanText(input.hireDate, '到職日', 10),
    role,
    active: input.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const ref = db.collection('employees').doc(employeeId)
  const existing = await ref.get()
  let user
  try {
    user = await auth.getUser(employeeId)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    await importTemporaryPasswordUser({ employeeId, displayName: record.name, disabled: !record.active, customClaims: { employeeId, role, active: record.active, mustChangePassword: true } })
    user = await auth.getUser(employeeId)
  }
  const mustChangePassword = existing.exists ? existing.data().mustChangePassword === true : true
  await auth.updateUser(user.uid, { displayName: record.name, disabled: !record.active })
  await auth.setCustomUserClaims(user.uid, { employeeId, role, active: record.active, mustChangePassword })
  await ref.set({ ...record, mustChangePassword, createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp() }, { merge: true })
  await auth.revokeRefreshTokens(user.uid)
  await audit(existing.exists ? 'employee.updated' : 'employee.created', actor.employeeId, employeeId, { role, active: record.active })
  return { employeeId }
})

exports.adminSetActive = onCall(async request => {
  const actor = await requireAdmin(request)
  const employeeId = cleanId(request.data?.employeeId)
  const active = request.data?.active === true
  if (employeeId === actor.employeeId && !active) throw new HttpsError('failed-precondition', '不可停用自己的管理員帳號')
  const ref = db.collection('employees').doc(employeeId)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new HttpsError('not-found', '找不到員工')
  await auth.updateUser(employeeId, { disabled: !active })
  await auth.setCustomUserClaims(employeeId, { employeeId, role: snapshot.data().role, active, mustChangePassword: snapshot.data().mustChangePassword === true })
  await ref.update({ active, updatedAt: FieldValue.serverTimestamp() })
  await auth.revokeRefreshTokens(employeeId)
  await audit(active ? 'employee.enabled' : 'employee.disabled', actor.employeeId, employeeId)
  return { success: true }
})

exports.adminResetPassword = onCall(async request => {
  const actor = await requireAdmin(request)
  const employeeId = cleanId(request.data?.employeeId)
  const ref = db.collection('employees').doc(employeeId)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new HttpsError('not-found', '找不到員工')
  const existingUser = await auth.getUser(employeeId)
  const customClaims = { employeeId, role: snapshot.data().role, active: snapshot.data().active === true, mustChangePassword: true }
  const replacement = { employeeId, displayName: existingUser.displayName || snapshot.data().name, disabled: !customClaims.active, customClaims }
  await auth.deleteUser(employeeId)
  await importTemporaryPasswordUser(replacement)
  await ref.update({ mustChangePassword: true, passwordResetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await auth.revokeRefreshTokens(employeeId)
  await audit('password.admin_reset', actor.employeeId, employeeId)
  return { success: true }
})

exports.adminSyncEmployees = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async request => {
  const actor = await requireAdmin(request)
  const rows = Array.isArray(request.data?.employees) ? request.data.employees : []
  if (!rows.length || rows.length > 1000) throw new HttpsError('invalid-argument', '員工批次資料筆數不正確')
  const seen = new Set()
  const conflicts = []
  const normalized = []
  for (const row of rows) {
    const employeeId = cleanId(row.employeeId)
    if (seen.has(employeeId)) { conflicts.push(employeeId); continue }
    seen.add(employeeId)
    normalized.push({ employeeId, name: cleanText(row.name, '姓名'), title: cleanText(row.title, '職稱'), hireDate: String(row.hireDate || '2020-01-01'), role: cleanRole(row.role || 'employee') })
  }
  let created = 0
  let updated = 0
  for (let offset = 0; offset < normalized.length; offset += 100) {
    const chunk = normalized.slice(offset, offset + 100)
    await Promise.all(chunk.map(async row => {
      const ref = db.collection('employees').doc(row.employeeId)
      const existing = await ref.get()
      let user
      let createdUser = false
      try {
        user = await auth.getUser(row.employeeId)
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error
        await importTemporaryPasswordUser({ employeeId: row.employeeId, displayName: row.name, customClaims: { employeeId: row.employeeId, role: row.role, active: true, mustChangePassword: true } })
        user = await auth.getUser(row.employeeId)
        createdUser = true
      }
      const active = existing.exists ? existing.data().active !== false : true
      const mustChangePassword = existing.exists ? existing.data().mustChangePassword === true : true
      const desiredClaims = { employeeId: row.employeeId, role: row.role, active, mustChangePassword }
      if (createdUser || JSON.stringify(user.customClaims || {}) !== JSON.stringify(desiredClaims)) {
        await auth.setCustomUserClaims(user.uid, desiredClaims)
      }
      await ref.set({ ...row, active, mustChangePassword, updatedAt: FieldValue.serverTimestamp(), createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp() }, { merge: true })
      if (existing.exists) updated += 1
      else created += 1
    }))
  }
  await audit('employees.synced', actor.employeeId, '*', { created, updated, conflicts })
  return { created, updated, conflicts }
})

exports.generateDailyDispatch = onCall(async request => {
  const actor = await requireDuty(request)
  const date = String(request.data?.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('invalid-argument', '日期格式不正確')
  const schedules = await db.collection('scheduleRecords').where('date', '==', date).get()
  const areas = await db.collection('areaMaster').where('active', '==', true).get()
  const areaMap = new Map(areas.docs.map(item => [item.id, item.data()]))
  const batch = db.batch(); let count = 0
  for (const schedule of schedules.docs) {
    const data = schedule.data(); const code = String(data.scheduleCode || '')
    if (!code || ['例', '休', '休上', '慰', '假'].includes(code) || /病|事|特/.test(code)) continue
    const areaCode = [...areaMap.keys()].sort((a, b) => b.length - a.length).find(area => code.includes(area)) || ''
    if (!areaCode) continue
    const area = areaMap.get(areaCode)
    const id = `${date}-${data.employeeId}-${data.shiftType}`
    batch.set(db.collection('dispatchRecords').doc(id), { id, date, employeeId: data.employeeId, employeeName: data.employeeName, scheduleCode: code, areaCode, areaName: area.areaName || areaCode, vehicleType: area.defaultVehicleType || '', vehicleNo: area.defaultVehicleNo || '', driver: '', assistant: '', station: area.defaultStation || '', workFocus: area.defaultWorkFocus || '', balanceArea: area.defaultBalanceArea || '', note: '', source: 'scheduleRecords', status: 'active', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), modifiedBy: actor.employeeId, modifiedAt: FieldValue.serverTimestamp() }, { merge: true }); count += 1
  }
  await batch.commit(); await audit('dispatch.generated', actor.employeeId, date, { count }); return { date, count }
})

async function syncDispatchBlocksForDate(date, actorId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('invalid-argument', '日期格式不正確')
  const [, month, day] = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  const daySheet = '雙北今日派工單看這邊'
  const nightSheet = `${Number(month)}/${Number(day)}大夜派工單`
  const spreadsheetId = '1RBzq8miIdUFCTM2PZhAsDe7rNMCdfMxN6lVfV-NLhmk'
  const readSheet = async sheet => {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`
    const response = await fetch(url)
    if (!response.ok) throw new HttpsError('failed-precondition', `無法讀取分頁：${sheet}`)
    return { rows: parseCsv(await response.text()), sheet }
  }
  const [daySource, nightSource, employeeSnapshot] = await Promise.all([
    readSheet(daySheet), readSheet(nightSheet), db.collection('employees').where('active', '==', true).get(),
  ])
  const dayMarker = `${Number(month)}月${Number(day)}日`
  if (!daySource.rows.slice(0, 3).flat().some(value => String(value).includes(dayMarker))) throw new HttpsError('failed-precondition', `白天即時分頁不是 ${date}`)
  if (!nightSource.rows.slice(0, 3).flat().some(value => String(value).includes(`${Number(month)}/${Number(day)}`))) throw new HttpsError('failed-precondition', `大夜分頁不是 ${date}`)
  const employees = employeeSnapshot.docs.map(item => ({ employeeId: item.id, name: item.data().name }))
  const dayResult = parseDay(daySource.rows, date, employees)
  const nightResult = parseNight(nightSource.rows, date, nightSheet, employees)
  const parsedBlocks = [...dayResult.blocks, ...nightResult.blocks]
  const existingSnapshot = await db.collection('dispatchBlocks').where('date', '==', date).get()
  const existing = new Map(existingSnapshot.docs.map(item => [item.id, item.data()]))
  const parsedIds = new Set(parsedBlocks.map(block => block.blockId))
  const editableFields = ['vehicleNo', 'drivers', 'stations', 'assistants', 'workFocus', 'balanceArea', 'note']
  const writes = []
  for (const block of parsedBlocks) {
    const previous = existing.get(block.blockId)
    const payload = { ...block, sourceUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdAt: previous?.createdAt || FieldValue.serverTimestamp(), modifiedBy: previous?.modifiedBy || '', modifiedAt: previous?.modifiedAt || null }
    if (previous?.modifiedAt) for (const field of editableFields) payload[field] = previous[field]
    writes.push({ ref: db.collection('dispatchBlocks').doc(block.blockId), payload })
  }
  for (const item of existingSnapshot.docs) if (!parsedIds.has(item.id)) writes.push({ ref: item.ref, payload: { status: 'stale', updatedAt: FieldValue.serverTimestamp() } })
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch()
    for (const write of writes.slice(offset, offset + 400)) batch.set(write.ref, write.payload, { merge: true })
    await batch.commit()
  }
  const conflicts = [...dayResult.conflicts, ...nightResult.conflicts]
  for (const conflict of conflicts) await db.collection('dispatchBlockConflicts').add({ ...conflict, date, status: 'unresolved', createdAt: FieldValue.serverTimestamp() })
  await audit('dispatchBlocks.synced', actorId, date, { dayBlocks: dayResult.blocks.length, nightBlocks: nightResult.blocks.length, conflicts: conflicts.length })
  return { date, dayBlocks: dayResult.blocks.length, nightBlocks: nightResult.blocks.length, conflicts: conflicts.length }
}

exports.syncDispatchBlocks = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async request => {
  const actor = await requireDuty(request)
  const date = String(request.data?.date || '')
  return syncDispatchBlocksForDate(date, actor.employeeId)
})

exports.syncCurrentDispatchBlocks = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Taipei', timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = type => parts.find(part => part.type === type).value
  return syncDispatchBlocksForDate(`${value('year')}-${value('month')}-${value('day')}`, 'system-scheduler')
})

exports._test = { cleanId, employeeEmail }
