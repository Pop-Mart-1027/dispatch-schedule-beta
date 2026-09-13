import { monthlyRoster, placeMonthlyPerson } from './pre-schedule-roster.mjs';
import { mayReview, preScheduleGroup } from './pre-schedule-domain.mjs';

// Called only after the existing actor/role checks in preSchedule.
export async function managePreSchedulePeople({ db, ref, input, actorId, now, stamp, fail }) {
  const rosterRef = ref.collection('internal').doc('roster');
  if (input.action === 'people') {
    const snap = await rosterRef.get();
    return { people: monthlyRoster(snap.data()?.people || []), revision: snap.data()?.revision || 0 };
  }
  const id = typeof input.employeeId === 'string' ? input.employeeId.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{1,40}$/.test(id)) fail('invalid-argument', '請輸入正確員工編號');
  const employeeRef = db.collection('employees').doc(id);
  const publicPerson = data => ({ employeeId: id, name: data.name, title: data.title || '', group: preScheduleGroup(data) });
  if (input.action === 'findPerson') {
    const snap = await employeeRef.get();
    if (!snap.exists) return { person: null };
    if (snap.data().active !== true) fail('failed-precondition', '此員工已停用，不能加入預排');
    return { person: publicPerson(snap.data()) };
  }
  if (input.action !== 'savePerson') fail('invalid-argument', '不支援的人員操作');
  if (!['add', 'edit'].includes(input.mode) || !['day', 'night'].includes(input.group) ||
      typeof input.section !== 'string' || !input.section.trim() || input.section.trim().length > 80 ||
      !Number.isSafeInteger(input.rosterRevision) || input.rosterRevision < 0 ||
      typeof input.beforeId !== 'string' || input.beforeId.length > 40)
    fail('invalid-argument', '請確認班別、區域及移動位置');
  const entryRef = ref.collection('entries').doc(id);
  return db.runTransaction(async tx => {
    const [monthSnap, rosterSnap, employeeSnap, entrySnap, settingsSnap] = await Promise.all([
      tx.get(ref), tx.get(rosterRef), tx.get(employeeRef), tx.get(entryRef),
      tx.get(db.collection('scheduleSettings').doc(input.monthKey)),
    ]);
    const data = monthSnap.data();
    const toMs = value => value?.toMillis?.() ?? value;
    const month = data && { ...data, closeAt: toMs(settingsSnap.data()?.endAt ?? data.closeAt) };
    if (!month || !mayReview(month, now())) fail('permission-denied', '截止後才可整理，發布中或已發布不可修改');
    if (!rosterSnap.exists) fail('failed-precondition', '此月份名單不存在，請先確認月份設定');
    if ((rosterSnap.data().revision || 0) !== input.rosterRevision) fail('aborted', '名單已被另一視窗修改，請重新開啟後再操作');
    if (!employeeSnap.exists) fail('not-found', '查無資料，請先新增員工編號');
    if (employeeSnap.data().active !== true) fail('failed-precondition', '此員工已停用');
    const people = monthlyRoster(rosterSnap.data().people || []);
    const old = people.find(p => p.employeeId === id);
    if (input.mode === 'add' && (old || entrySnap.exists)) fail('already-exists', '此員工已在本月份名單或已有預排，請勿重複加入');
    if (input.mode === 'edit' && !old) fail('not-found', '此員工已不在本月份名單，請重新載入');
    // Editing layout cannot silently change an employee's identity snapshot.
    const person = {
      ...(old || publicPerson(employeeSnap.data())),
      group: input.group, rosterGroup: input.group, rosterSection: input.section.trim(),
    };
    let next;
    try { next = placeMonthlyPerson(people, person, input.beforeId); }
    catch (e) { fail('aborted', e.message); }
    const revision = input.rosterRevision + 1;
    tx.set(rosterRef, { people: next, revision, updatedAt: stamp(), updatedBy: actorId }, { merge: true });
    // Preserve all request/arrangement cells and notes; invalidate stale editors.
    if (entrySnap.exists) tx.update(entryRef, {
      group: person.group, revision: (entrySnap.data().revision || 0) + 1,
      modifiedBy: actorId, modifiedAt: stamp(), updatedAt: stamp(),
    });
    tx.update(ref, { updatedAt: stamp() });
    tx.set(ref.collection('auditLogs').doc(), {
      action: input.mode === 'add' ? 'roster-add' : 'roster-edit-move', employeeId: id,
      modifiedBy: actorId, modifiedAt: stamp(), before: old || null,
      after: next.find(p => p.employeeId === id), beforeId: input.beforeId,
    });
    return { person: next.find(p => p.employeeId === id), revision };
  });
}
