'use strict'

const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { setGlobalOptions } = require('firebase-functions/v2/options')
const bcrypt = require('bcryptjs')

initializeApp()
setGlobalOptions({ region: 'asia-east1', maxInstances: 10 })

const db = getFirestore()
const auth = getAuth()
const ROLES = new Set(['employee', 'duty', 'admin'])
const EMPLOYEE_ID = /^[A-Z0-9]{3,20}$/

function cleanId(value) {
  const id = String(value || '').trim().toUpperCase()
  if (!EMPLOYEE_ID.test(id)) throw new HttpsError('invalid-argument', '員工編號格式不正確')
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
  return `${employeeId.toLowerCase()}@employees.smilebike.invalid`
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
  // A freshly imported admin may perform the one-time directory sync before
  // its Firestore profile exists. The signed custom claim is issued only by Admin SDK/import.
  if (!snapshot.exists) return { employeeId, snapshot: null }
  const user = { employeeId, snapshot }
  if (snapshot.data().active !== true) throw new HttpsError('permission-denied', '帳號已停用')
  if (user.snapshot.data().role !== 'admin') throw new HttpsError('permission-denied', '需要管理員權限')
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

exports._test = { cleanId, employeeEmail }
