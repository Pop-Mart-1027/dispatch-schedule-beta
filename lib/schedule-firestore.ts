import {
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

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

export async function listScheduleRecords(date: string, employeeId?: string) {
  const constraints = employeeId
    ? [where('employeeId', '==', employeeId)]
    : [where('date', '==', date)];
  const snapshot = await getDocs(
    query(collection(db, 'scheduleRecords'), ...constraints),
  );
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ScheduleRecord)
    .filter((record) => !employeeId || record.date === date);
}

export async function listMonthScheduleRecords(
  month: string,
  employeeId?: string,
) {
  const constraints = employeeId
    ? [where('employeeId', '==', employeeId)]
    : [where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`)];
  const snapshot = await getDocs(
    query(collection(db, 'scheduleRecords'), ...constraints),
  );
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ScheduleRecord)
    .filter((record) => record.date.startsWith(`${month}-`));
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
