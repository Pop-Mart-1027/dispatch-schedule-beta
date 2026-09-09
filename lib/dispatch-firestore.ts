import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'

export type DispatchRecord = { id: string; date: string; employeeId: string; employeeName: string; scheduleCode: string; areaCode: string; areaName: string; vehicleType: string; vehicleNo: string; driver: string; assistant: string; station: string; workFocus: string; balanceArea: string; note: string; source: string; status: string; createdAt?: unknown; updatedAt?: unknown; modifiedBy: string; modifiedAt?: unknown }
export type AreaMaster = { areaCode: string; areaName: string; defaultVehicleType: string; defaultVehicleNo: string; defaultStation: string; defaultWorkFocus: string; defaultBalanceArea: string; active: boolean; sortOrder: number }

export async function listDispatchRecords(date: string, employeeId?: string) {
  const constraints = employeeId ? [where('employeeId', '==', employeeId)] : [where('date', '==', date)]
  const snapshot = await getDocs(query(collection(db, 'dispatchRecords'), ...constraints))
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as DispatchRecord)).filter(record => !employeeId || record.date === date)
}
export async function listAreaMaster() {
  const snapshot = await getDocs(query(collection(db, 'areaMaster'), orderBy('sortOrder', 'asc')))
  return snapshot.docs.map(item => ({ areaCode: item.id, ...item.data() } as AreaMaster))
}
export async function updateDispatchRecord(id: string, values: Partial<DispatchRecord>, modifiedBy: string) {
  const ref = doc(db, 'dispatchRecords', id)
  const payload: Record<string, unknown> = { ...values, id, modifiedBy, modifiedAt: serverTimestamp(), updatedAt: serverTimestamp() }
  if (!(await getDoc(ref)).exists()) payload.createdAt = serverTimestamp()
  await setDoc(ref, payload, { merge: true })
}
export async function writeDispatchAudit(recordId: string, date: string, before: DispatchRecord, after: Partial<DispatchRecord>, modifiedBy: string) {
  await addDoc(collection(db, 'dispatchAuditLogs'), { recordId, date, before, after, modifiedBy, createdAt: serverTimestamp() })
}
