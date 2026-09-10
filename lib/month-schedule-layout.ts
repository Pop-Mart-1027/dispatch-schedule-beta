import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
export type MonthRow = {
  employeeId: string;
  group: 'day' | 'night';
  section: string;
  areaCode: string | null;
  blankDays: string[];
};
export type MonthLayout = {
  monthKey: string;
  rows: MonthRow[];
  revision: number;
  excludedEmployeeIds?: string[];
  assignmentResetAt?: Record<string, Record<string, unknown>>;
};
export async function getMonthLayout(monthKey: string, database = db) {
  const snap = await getDoc(doc(database, 'scheduleMonthLayouts', monthKey));
  return snap.exists() ? (snap.data() as MonthLayout) : null;
}
export async function manageMonthRow(input: Record<string, unknown>) {
  return (await httpsCallable(functions, 'manageScheduleMonthRow')(input)).data;
}
