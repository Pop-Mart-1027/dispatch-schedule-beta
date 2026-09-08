import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: 'AIzaSyDKvg52sZCYoGs8jJjf5Qlt5rgtoT3Zbw0',
  authDomain: 'breakfast-order-system-83890.firebaseapp.com',
  projectId: 'breakfast-order-system-83890',
  storageBucket: 'breakfast-order-system-83890.firebasestorage.app',
  messagingSenderId: '667405351082',
  appId: '1:667405351082:web:748291dd532143c8d5f8d3',
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
