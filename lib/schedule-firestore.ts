import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'

export type ScheduleRecord = {
  id: string; date: string; employeeId: string; employeeName: string; shiftType: 'morning' | 'night';
  scheduleCode: string; scheduleLabel: string; leaveType: string; source: string; status: string; note: string;
  createdAt?: unknown; updatedAt?: unknown; modifiedBy: string
}

export async function listScheduleRecords(date: string, employeeId?: string) {
  const constraints = employeeId ? [where('employeeId', '==', employeeId)] : [where('date', '==', date)]
  const snapshot = await getDocs(query(collection(db, 'scheduleRecords'), ...constraints))
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleRecord)).filter(record => !employeeId || record.date === date)
}

export async function listMonthScheduleRecords(month: string, employeeId?: string) {
  const constraints = employeeId ? [where('employeeId', '==', employeeId)] : [where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`)]
  const snapshot = await getDocs(query(collection(db, 'scheduleRecords'), ...constraints))
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleRecord)).filter(record => record.date.startsWith(`${month}-`))
}
