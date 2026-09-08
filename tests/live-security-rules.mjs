import assert from 'node:assert/strict'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, updateDoc } from 'firebase/firestore'

const config = {
  apiKey: 'AIzaSyDKvg52sZCYoGs8jJjf5Qlt5rgtoT3Zbw0',
  authDomain: 'breakfast-order-system-83890.firebaseapp.com',
  projectId: 'breakfast-order-system-83890',
  appId: '1:667405351082:web:748291dd532143c8d5f8d3',
}
const app = initializeApp(config, `live-rules-test-${Date.now()}`)
const auth = getAuth(app)
const db = getFirestore(app)
const fails = async operation => { try { await operation(); return false } catch { return true } }

assert.equal(await fails(() => getDoc(doc(db, 'employees', 'B5456'))), true)
await signInWithEmailAndPassword(auth, 'b5456@employees.smilebike.invalid', 'B5456')
assert.equal((await getDoc(doc(db, 'employees', 'B5456'))).exists(), true)
assert.equal(await fails(() => getDoc(doc(db, 'employees', '93947'))), true)
assert.equal(await fails(() => getDocs(collection(db, 'employees'))), true)
assert.equal(await fails(() => updateDoc(doc(db, 'employees', 'B5456'), { role: 'admin' })), true)
assert.equal(await fails(() => getDocs(collection(db, 'attendanceLocations'))), true)
await signOut(auth)
console.log(JSON.stringify({ rules: 'PASS', anonymousDenied: true, selfRead: true, otherEmployeeDenied: true, selfPromotionDenied: true, forcedPasswordBlocksBusinessData: true }))
