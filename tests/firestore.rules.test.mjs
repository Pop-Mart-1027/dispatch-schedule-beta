import fs from 'node:fs/promises'
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'

let environment
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-smilebike',
    firestore: { rules: await fs.readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  })
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'employees', 'E001'), { employeeId: 'E001', name: '一般員工', role: 'employee', active: true })
    await setDoc(doc(context.firestore(), 'employees', 'A001'), { employeeId: 'A001', name: '管理員', role: 'admin', active: true })
    await setDoc(doc(context.firestore(), 'employees', 'A002'), { employeeId: 'A002', name: '停用管理員', role: 'admin', active: false })
  })
})
after(async () => environment?.cleanup())

test('anonymous users cannot read employee master', async () => {
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'employees', 'E001')))
})

test('employees may read self but cannot promote self or read others', async () => {
  const db = environment.authenticatedContext('uid-e001', { employeeId: 'E001', role: 'employee' }).firestore()
  await assertSucceeds(getDoc(doc(db, 'employees', 'E001')))
  await assertFails(getDoc(doc(db, 'employees', 'A001')))
  await assertFails(updateDoc(doc(db, 'employees', 'E001'), { role: 'admin' }))
})

test('active admins may list while inactive admins cannot', async () => {
  const active = environment.authenticatedContext('uid-a001', { employeeId: 'A001', role: 'admin' }).firestore()
  const inactive = environment.authenticatedContext('uid-a002', { employeeId: 'A002', role: 'admin' }).firestore()
  assert.equal((await assertSucceeds(getDocs(collection(active, 'employees')))).size, 3)
  await assertFails(getDocs(collection(inactive, 'employees')))
})

test('existing breakfast order create rule remains valid', async () => {
  const db = environment.unauthenticatedContext().firestore()
  await assertSucceeds(setDoc(doc(db, 'orders', 'regression'), { status: 'new', paid: false, total: 10, paymentMethod: 'cash', paymentStatus: 'unpaid' }))
})
