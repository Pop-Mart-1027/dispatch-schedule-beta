import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  "apiKey": "AIzaSyA5eEPxHg6n2MxyrX0ZHHE8DKx8yh-r4ws",
  "authDomain": "meimei-breakfast-order.firebaseapp.com",
  "projectId": "meimei-breakfast-order",
  "storageBucket": "meimei-breakfast-order.firebasestorage.app",
  "messagingSenderId": "1086953376984",
  "appId": "1:1086953376984:web:70b05d0b41c86df8145bad"
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const functions = getFunctions(firebaseApp, 'asia-east1')

export function employeeEmail(employeeId: string) {
  const normalized = employeeId.trim().toUpperCase()
  if (/^[A-Z0-9]{3,20}$/.test(normalized)) return `${normalized.toLowerCase()}@employees.smilebike.invalid`
  const encoded = Array.from(new TextEncoder().encode(normalized), byte => byte.toString(16).padStart(2, '0')).join('')
  return `id-${encoded}@employees.smilebike.invalid`
}
