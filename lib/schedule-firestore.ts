import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { getMonthLayout } from './month-schedule-layout';
import { eligibleMonthSchedules, monthParticipation } from '../functions/month-schedule-policy.mjs';

export type ScheduleRecord = {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  shiftType: 'morning' | 'night';
  scheduleCode: string;
  scheduleLabel: string;
  leaveType: string;
  source: string;
  status: string;
  note: string;
  title?: string;
  group?: string;
  area?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  modifiedBy: string;
};

export async function getScheduleRecord(id: string, database = db) {
  const snapshot = await getDoc(doc(database, 'scheduleRecords', id));
  if (!snapshot.exists()) throw new Error('班表已儲存，但重新讀取失敗，請重新載入。');
  return { id: snapshot.id, ...snapshot.data() } as ScheduleRecord;
}

export async function listScheduleRecords(date: string, employeeId?: string, database = db) {
  const constraints = employeeId
    ? [where('employeeId', '==', employeeId)]
    : [where('date', '==', date)];
  const [snapshot, layout] = await Promise.all([getDocs(
    query(collection(database, 'scheduleRecords'), ...constraints),
  ), getMonthLayout(date.slice(0, 7), database)]);
  return eligibleMonthSchedules(snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ScheduleRecord)
    .filter((record) => !employeeId || record.date === date), layout) as ScheduleRecord[];
}

export async function listMonthScheduleRecords(
  month: string,
  employeeId?: string,
  database = db,
) {
  const constraints = employeeId
    ? [where('employeeId', '==', employeeId), where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`)]
    : [where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`)];
  const [snapshot, layout] = await Promise.all([getDocs(
    query(collection(database, 'scheduleRecords'), ...constraints),
  ), getMonthLayout(month, database)]);
  return eligibleMonthSchedules(snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ScheduleRecord)
    .filter((record) => record.date.startsWith(`${month}-`)), layout) as ScheduleRecord[];
}

export async function updateFormalScheduleCell(
  record: ScheduleRecord,
  code: string,
  modifiedBy: string,
  database = db,
) {
  const ref = doc(database, 'scheduleRecords', record.id),
    audit = doc(collection(database, 'scheduleAuditLogs'));
  await runTransaction(database, async (transaction) => {
    const snap = await transaction.get(ref);
    const layout = await transaction.get(doc(database, 'scheduleMonthLayouts', record.date.slice(0, 7)));
    if (!monthParticipation(layout.data(), record.employeeId, record.date))
      throw new Error('此員工已移出本月班表，或此格尚未加入正式排班，請重新載入。');
    const current = snap.data();
    if (
      !current ||
      current.employeeId !== record.employeeId ||
      current.date !== record.date ||
      current.scheduleCode !== record.scheduleCode
    )
      throw new Error('班表已被其他人修改，請關閉面板並重新載入後再試。');
    const after = {
      scheduleCode: code,
      scheduleLabel: code,
      leaveType: /休|例|慰|病|事|假|特|家庭照顧|喪|^公$/.test(code) ? code : '',
    };
    transaction.update(ref, {
      ...after,
      modifiedBy,
      modifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(audit, {
      recordId: record.id,
      employeeId: record.employeeId,
      date: record.date,
      before: {
        scheduleCode: current.scheduleCode,
        scheduleLabel: current.scheduleLabel || '',
        leaveType: current.leaveType || '',
      },
      after,
      modifiedBy,
      modifiedAt: serverTimestamp(),
    });
  });
}
