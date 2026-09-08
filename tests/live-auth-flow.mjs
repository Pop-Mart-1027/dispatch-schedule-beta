import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'

const config = {
  apiKey: 'AIzaSyDKvg52sZCYoGs8jJjf5Qlt5rgtoT3Zbw0',
  authDomain: 'breakfast-order-system-83890.firebaseapp.com',
  projectId: 'breakfast-order-system-83890',
  appId: '1:667405351082:web:748291dd532143c8d5f8d3',
}
const auth = getAuth(initializeApp(config, `live-auth-test-${Date.now()}`))
const email = id => `${id.toLowerCase()}@employees.smilebike.invalid`
const signIn = (id, password) => signInWithEmailAndPassword(auth, email(id), password)
const invoke = async (name, data = {}) => {
  const token = await auth.currentUser.getIdToken(true)
  const response = await fetch(`https://asia-east1-breakfast-order-system-83890.cloudfunctions.net/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data }),
  })
  const body = await response.json()
  if (!response.ok || body.error) throw new Error(`${name}: ${body.error?.message || response.status}`)
  return body.result
}
const fails = async operation => { try { await operation(); return false } catch { return true } }

const employeeId = 'B5456'
const adminId = 'B0957'
const firstNewPassword = `T!${crypto.randomBytes(18).toString('base64url')}`
const secondNewPassword = `T!${crypto.randomBytes(18).toString('base64url')}`
const checks = []

await signIn(employeeId, employeeId)
let profile = await invoke('getMyProfile')
assert.equal(profile.mustChangePassword, true)
checks.push('initial employee-id login + first-login enforcement')

await invoke('changeOwnPassword', { newPassword: firstNewPassword })
await signOut(auth)
assert.equal(await fails(() => signIn(employeeId, employeeId)), true)
await signIn(employeeId, firstNewPassword)
profile = await invoke('getMyProfile')
assert.equal(profile.mustChangePassword, false)
checks.push('old password invalid + new password login')
await signOut(auth)
assert.equal(await fails(() => signIn(employeeId, `bad-${crypto.randomUUID()}`)), true)
checks.push('logout + incorrect password rejected')

await signIn(adminId, adminId)
await invoke('adminSetActive', { employeeId, active: false })
await signOut(auth)
assert.equal(await fails(() => signIn(employeeId, firstNewPassword)), true)
checks.push('disabled account rejected')

await signIn(adminId, adminId)
await invoke('adminSetActive', { employeeId, active: true })
await invoke('adminResetPassword', { employeeId })
await signOut(auth)
await signIn(employeeId, employeeId)
profile = await invoke('getMyProfile')
assert.equal(profile.mustChangePassword, true)
checks.push('admin reset restores employee-id temporary password + enforcement')

await invoke('changeOwnPassword', { newPassword: secondNewPassword })
await signOut(auth)
assert.equal(await fails(() => signIn(employeeId, employeeId)), true)
await signIn(employeeId, secondNewPassword)
profile = await invoke('getMyProfile')
assert.equal(profile.mustChangePassword, false)
checks.push('second forced change invalidates temporary password')

await signOut(auth)
await signIn(adminId, adminId)
await invoke('adminResetPassword', { employeeId })
await signOut(auth)
console.log(JSON.stringify({ passed: checks.length, checks, restored: { employeeId, temporaryPasswordRule: 'employeeId', mustChangePassword: true } }, null, 2))
