import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
export type MonthRow = {
  employeeId: string;
  group: 'day' | 'night';
  section: string;
  areaCode: string | null;
  blankDays: string[];
  sectionKey?: string;
};
export type MonthSection = {
  key: string;
  group: 'day' | 'night';
  section: string;
  areaCode: string | null;
  label: string;
};
export type MonthLayout = {
  monthKey: string;
  rows: MonthRow[];
  revision: number;
  sections?: MonthSection[];
  excludedEmployeeIds?: string[];
  assignmentResetAt?: Record<string, Record<string, unknown>>;
};
// Share concurrent reads only. Never reuse settled data across edits or dates.
const pendingLayouts = new WeakMap<object, Map<string, Promise<MonthLayout | null>>>();
export function getMonthLayout(monthKey: string, database = db) {
  let pending = pendingLayouts.get(database);
  if (!pending) { pending = new Map(); pendingLayouts.set(database, pending); }
  const existing = pending.get(monthKey);
  if (existing) return existing;
  const request = getDoc(doc(database, 'scheduleMonthLayouts', monthKey))
    .then(snap => snap.exists() ? snap.data() as MonthLayout : null)
    .finally(() => { if (pending!.get(monthKey) === request) pending!.delete(monthKey); });
  pending.set(monthKey, request);
  return request;
}
export async function manageMonthRow(input: Record<string, unknown>) {
  return (await httpsCallable(functions, 'manageScheduleMonthRow')(input)).data;
}
