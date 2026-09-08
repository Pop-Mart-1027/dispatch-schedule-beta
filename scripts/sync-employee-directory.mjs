import fs from 'node:fs/promises'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyDKvg52sZCYoGs8jJjf5Qlt5rgtoT3Zbw0',
  authDomain: 'breakfast-order-system-83890.firebaseapp.com',
  projectId: 'breakfast-order-system-83890',
  appId: '1:667405351082:web:748291dd532143c8d5f8d3',
}
const seed = JSON.parse(await fs.readFile(new URL('../outputs/employees-seed.json', import.meta.url), 'utf8'))
const bootstrap = seed.employees.find(employee => employee.employeeId === 'B0957')
if (!bootstrap) throw new Error('找不到啟始管理員')
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
await signInWithEmailAndPassword(auth, `${bootstrap.employeeId.toLowerCase()}@employees.smilebike.invalid`, bootstrap.employeeId)
const idToken = await auth.currentUser.getIdToken(true)
const response = await fetch('https://asia-east1-breakfast-order-system-83890.cloudfunctions.net/adminSyncEmployees', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ data: seed }),
})
const result = await response.json()
if (!response.ok || result.error) throw new Error(result.error?.message || `同步失敗 (${response.status})`)
console.log(JSON.stringify(result.result))
await signOut(auth)
