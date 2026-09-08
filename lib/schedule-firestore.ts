import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from './firebase'

export type ScheduleRecord = {
  id: string; date: string; employeeId: string; employeeName: string; shiftType: 'morning' | 'night';
  scheduleCode: string; scheduleLabel: string; leaveType: string; source: string; status: string; note: string;
  createdAt?: unknown; updatedAt?: unknown; modifiedBy: string
}

export async function listScheduleRecords(date: string, employeeId?: string) {
  const constraints = [where('date', '==', date), orderBy('employeeId', 'asc')]
  if (employeeId) constraints.unshift(where('employeeId', '==', employeeId))
  const snapshot = await getDocs(query(collection(db, 'scheduleRecords'), ...constraints))
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleRecord))
}

export async function listMonthScheduleRecords(month: string, employeeId?: string) {
  const constraints = [where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`), orderBy('date', 'asc'), orderBy('employeeId', 'asc')]
  if (employeeId) constraints.unshift(where('employeeId', '==', employeeId))
  const snapshot = await getDocs(query(collection(db, 'scheduleRecords'), ...constraints))
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleRecord))
}
