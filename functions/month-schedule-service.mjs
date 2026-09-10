import { initialMonthRows, changeMonthRows } from './month-schedule-layout.mjs';
import { moveWorkArea } from './month-schedule-policy.mjs';
export function createMonthScheduleService({ db, FieldValue, HttpsError }) {
  return async (request) => {
    const input = request.data || {},
      token = request.auth?.token,
      uid = request.auth?.uid;
    if (
      !uid ||
      token?.employeeId !== uid ||
      token.role !== 'admin' ||
      token.mustChangePassword !== false
    )
      throw new HttpsError(
        'permission-denied',
        '只有管理員可以管理正式班表人員',
      );
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.monthKey || '') ||
      typeof input.employeeId !== 'string' ||
      /[\/]/.test(input.employeeId) ||
      !input.employeeId
    )
      throw new HttpsError('invalid-argument', '月份或員編不正確');
    const ref = db.collection('scheduleMonthLayouts').doc(input.monthKey);
    const audit = db.collection('scheduleAuditLogs').doc();
    return db.runTransaction(async (tx) => {
      const [actor, employee, snapshot] = await Promise.all([
        tx.get(db.collection('employees').doc(uid)),
        tx.get(db.collection('employees').doc(input.employeeId)),
        tx.get(ref),
      ]);
      if (
        !actor.exists ||
        actor.data().role !== 'admin' ||
        actor.data().active !== true ||
        actor.data().mustChangePassword !== false
      )
        throw new HttpsError('permission-denied', '管理員權限已失效');
      if (!employee.exists) throw new HttpsError('not-found', '找不到正式員工');
      const current = snapshot.data();
      if ((current?.revision || 0) !== input.revision)
        throw new HttpsError('aborted', '本月人員已被修改，請重新載入後再試');
      if (input.action === 'cell') {
        const row = current?.rows.find(
          (r) => r.employeeId === input.employeeId,
        );
        const day = Number(String(input.date).slice(8));
        const count = new Date(
          Number(input.monthKey.slice(0, 4)),
          Number(input.monthKey.slice(5)),
          0,
        ).getDate();
        if (
          !row || current?.excludedEmployeeIds?.includes(input.employeeId) ||
          input.date !== `${input.monthKey}-${String(day).padStart(2, '0')}` ||
          day < 1 ||
          day > count ||
          typeof input.code !== 'string' ||
          !input.code.trim() ||
          input.code.length > 80
        )
          throw new HttpsError('invalid-argument', '請選擇有效日期與班碼');
        const records = await tx.get(
          db
            .collection('scheduleRecords')
            .where('employeeId', '==', input.employeeId)
            .where('date', '==', input.date),
        );
        if (records.size > 1)
          throw new HttpsError(
            'failed-precondition',
            '本日存在重複班表，請先確認',
          );
        const existing = records.docs[0],
          recordRef =
            existing?.ref ||
            db
              .collection('scheduleRecords')
              .doc(`${input.employeeId}_${input.date}`);
        const previous = existing?.data() || null;
        if (!row.blankDays.includes(String(day)) && previous)
          throw new HttpsError('failed-precondition', '此格已排班，請重新載入');
        const after = {
          ...(previous || {}),
          id: recordRef.id,
          date: input.date,
          employeeId: employee.id,
          employeeName: employee.data().name,
          shiftType: row.group === 'day' ? 'morning' : 'night',
          scheduleCode: input.code,
          scheduleLabel: input.code,
          leaveType: /休|例|慰|病|事|假|特|家庭照顧|喪|^公$/.test(input.code)
            ? input.code
            : '',
          source: previous?.source || 'admin-month-schedule',
          status: previous?.status || 'active',
          note: previous?.note || '',
          createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          modifiedBy: uid,
          modifiedAt: FieldValue.serverTimestamp(),
        };
        tx.set(recordRef, after);
        tx.update(ref, {
          rows: current.rows.map((r) =>
            r.employeeId === employee.id
              ? {
                  ...r,
                  blankDays: r.blankDays.filter((d) => d !== String(day)),
                }
              : r,
          ),
          revision: current.revision + 1,
          modifiedBy: uid,
          modifiedAt: FieldValue.serverTimestamp(),
        });
        tx.set(audit, {
          action: 'month-row-cell',
          employeeId: employee.id,
          employeeName: employee.data().name,
          date: input.date,
          monthKey: input.monthKey,
          recordId: recordRef.id,
          before: previous,
          after,
          modifiedBy: uid,
          modifiedAt: FieldValue.serverTimestamp(),
        });
        return { revision: current.revision + 1 };
      }
      let rows = current?.rows;
      if (!rows) {
        const [records, people] = await Promise.all([
          tx.get(
            db
              .collection('scheduleRecords')
              .where('date', '>=', `${input.monthKey}-01`)
              .where('date', '<=', `${input.monthKey}-31`)
              .select('employeeId', 'shiftType'),
          ),
          tx.get(db.collection('employees')),
        ]);
        const ids = new Map(
          records.docs.map((r) => [r.data().employeeId, r.data().shiftType]),
        );
        rows = initialMonthRows(
          people.docs
            .filter((p) => ids.has(p.id))
            .map((p) => ({
              ...p.data(),
              employeeId: p.id,
              shiftType: ids.get(p.id),
            })),
        );
      }
      let result;
      try {
        result = changeMonthRows(
          rows,
          input,
          { ...employee.data(), employeeId: employee.id },
          input.monthKey,
        );
      } catch (error) {
        throw new HttpsError('failed-precondition', error.message);
      }
      const revision = (current?.revision || 0) + 1;
      const excluded = new Set(current?.excludedEmployeeIds || []);
      if (input.action === 'remove') excluded.add(employee.id);
      if (input.action === 'add') excluded.delete(employee.id);
      const changes = [];
      if (input.action === 'move' && result.before.areaCode !== result.after.areaCode) {
        if (!result.before.areaCode || !result.after.areaCode)
          throw new HttpsError('failed-precondition', '原區域或新區域沒有可確認區碼，無法自動轉換工作班碼');
        const records = await tx.get(db.collection('scheduleRecords')
          .where('employeeId', '==', employee.id)
          .where('date', '>=', `${input.monthKey}-01`)
          .where('date', '<=', `${input.monthKey}-31`));
        const dates = new Set();
        for (const record of records.docs) {
          const before = record.data();
          if (dates.has(before.date)) throw new HttpsError('failed-precondition', '本月存在重複班表，請先確認');
          dates.add(before.date);
          if (result.before.blankDays.includes(String(Number(before.date.slice(8))))) continue;
          const code = moveWorkArea(before.scheduleCode || '', result.before.areaCode, result.after.areaCode);
          if (code === before.scheduleCode || !code) continue;
          const after = { scheduleCode: code, scheduleLabel: moveWorkArea(before.scheduleLabel || before.scheduleCode, result.before.areaCode, result.after.areaCode) };
          changes.push({ recordId: record.id, date: before.date,
            before: { scheduleCode: before.scheduleCode, scheduleLabel: before.scheduleLabel || '' }, after });
          tx.update(record.ref, { ...after, updatedAt: FieldValue.serverTimestamp(), modifiedBy: uid, modifiedAt: FieldValue.serverTimestamp() });
        }
      }
      const resetDates = input.action === 'move' ? changes.map(change => change.date)
        : input.action === 'add' ? result.after.blankDays.map(day => `${input.monthKey}-${day.padStart(2, '0')}`) : [];
      const assignmentResetAt = { ...(current?.assignmentResetAt || {}) };
      for (const date of resetDates) assignmentResetAt[date] = {
        ...(assignmentResetAt[date] || {}), [employee.id]: FieldValue.serverTimestamp(),
      };
      tx.set(ref, {
        monthKey: input.monthKey,
        rows: result.rows,
        excludedEmployeeIds: [...excluded],
        assignmentResetAt,
        revision,
        modifiedBy: uid,
        modifiedAt: FieldValue.serverTimestamp(),
      });
      tx.set(audit, {
        action: `month-row-${input.action}`,
        monthKey: input.monthKey,
        date: `${input.monthKey}-01`,
        employeeId: employee.id,
        employeeName: employee.data().name,
        fromSection: result.before?.section || null,
        toSection: result.after?.section || null,
        convertedDates: changes,
        resetManualAssignmentDates: resetDates,
        participationBefore: !!result.before && !(current?.excludedEmployeeIds || []).includes(employee.id),
        participationAfter: !!result.after && !excluded.has(employee.id),
        before: { row: result.before, order: rows.map((r) => r.employeeId) },
        after: {
          row: result.after,
          order: result.rows.map((r) => r.employeeId),
        },
        modifiedBy: uid,
        modifiedAt: FieldValue.serverTimestamp(),
      });
      return { revision, convertedCount: changes.length };
    });
  };
}
