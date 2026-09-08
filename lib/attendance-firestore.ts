import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { ATTENDANCE_LOCATIONS_COLLECTION, ATTENDANCE_RECORDS_COLLECTION, type AttendanceLocation, type AttendanceRecord } from './attendance'

export async function listAttendanceLocations() {
  const snapshot = await getDocs(query(collection(db, ATTENDANCE_LOCATIONS_COLLECTION), orderBy('sortOrder', 'asc')))
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as AttendanceLocation)
}

export async function listTodayAttendanceRecords(employeeId: string, date: string) {
  const snapshot = await getDocs(query(collection(db, ATTENDANCE_RECORDS_COLLECTION), where('employeeId', '==', employeeId), where('date', '==', date), orderBy('timestamp', 'desc')))
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as AttendanceRecord)
}

export async function createAttendanceRecord(record: AttendanceRecord) {
  return addDoc(collection(db, ATTENDANCE_RECORDS_COLLECTION), { ...record, createdAt: serverTimestamp() })
}

export async function saveAttendanceLocation(location: Omit<AttendanceLocation, 'createdAt' | 'updatedAt'>, id?: string) {
  const data = { ...location, updatedAt: serverTimestamp(), ...(id ? {} : { createdAt: serverTimestamp() }) }
  if (id) { await updateDoc(doc(db, ATTENDANCE_LOCATIONS_COLLECTION, id), data); return id }
  return (await addDoc(collection(db, ATTENDANCE_LOCATIONS_COLLECTION), data)).id
}

export async function removeAttendanceLocation(id: string) {
  await deleteDoc(doc(db, ATTENDANCE_LOCATIONS_COLLECTION, id))
}
