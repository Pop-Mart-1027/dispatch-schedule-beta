import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
} from 'firebase/firestore';
import { createPreScheduleService } from '../functions/pre-schedule-service.mjs';
const req = createRequire(new URL('../functions/index.js', import.meta.url));
const { initializeApp, deleteApp } = req('firebase-admin/app'),
  { getFirestore, FieldValue, Timestamp } = req('firebase-admin/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw Error('Emulator required; never run against production');
const projectId = 'demo-pre-month',
  monthKey = '2026-10';
const app = initializeApp({ projectId }, 'pre-tests'),
  db = getFirestore(app);
let clock = Date.parse('2026-09-10T00:00:00Z'),
  env;
class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const service = createPreScheduleService({
  db,
  FieldValue,
  Timestamp,
  HttpsError,
  now: () => clock,
});
const people = [
  ['P1', 'employee', 'morning'],
  ['P2', 'employee', 'small-night'],
  ['M1', 'duty', 'morning'],
  ['A1', 'admin', 'morning'],
];
const auth = (id) => ({
  uid: id,
  token: {
    employeeId: id,
    role: people.find((p) => p[0] === id)[1],
    mustChangePassword: false,
  },
});
const call = (id, action, extra = {}) =>
  service.handle({
    auth: auth(id),
    data: {
      monthKey,
      action,
      ...extra,
      ...(action === 'review' && extra.days
        ? { arrangedDays: extra.days }
        : {}),
    },
  });
const formalCount = async () =>
  (
    await db
      .collection('scheduleRecords')
      .where('date', '>=', '2026-10-01')
      .get()
  ).size;
const days = Array.from(
  { length: 31 },
  (_, i) =>
    ['例', '休', '上班', '上班', '上班', '上班', '上班'][
      new Date(
        `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      ).getUTCDay()
    ],
);
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(
        new URL('../firestore.rules', import.meta.url),
        'utf8',
      ),
    },
  });
  await env.clearFirestore();
  for (const [id, role, shiftType] of people)
    await db.doc(`employees/${id}`).set({
      employeeId: id,
      name: id,
      title: shiftType === 'small-night' ? 'PT-夜' : '調度專員',
      role,
      shiftType,
      active: true,
      mustChangePassword: false,
    });
  await db.doc('scheduleSettings/2026-10').set({
    startAt: Timestamp.fromMillis(clock - 1000),
    endAt: Timestamp.fromMillis(clock + 10000),
    status: 'open',
  });
  for (const [id, , shift] of people)
    await db.doc(`scheduleRecords/${id}_2026-09-30`).set({
      employeeId: id,
      date: '2026-09-30',
      shiftType: shift === 'small-night' ? 'night' : 'morning',
      scheduleCode: id === 'P2' ? '夜O4' : '早A1',
    });
  await db.doc('scheduleRecords/P2_2026-09-29').set({
    employeeId: 'P2',
    date: '2026-09-29',
    shiftType: 'night',
    scheduleCode: '小夜O1',
  });
});
after(async () => {
  await env.cleanup();
  await deleteApp(app);
});
test('admin opens from existing settings; exactly two groups; employee reads only own entry', async () => {
  const ctx = await call('P1', 'context');
  assert.equal(ctx.month, null);
  assert.ok(ctx.settings.startAt);
  await call('A1', 'configure', {
    openAt: clock - 1000,
    closeAt: clock + 10000,
    status: 'open',
  });
  assert.equal((await call('M1', 'group', { group: 'day' })).roster.length, 3);
  assert.equal(
    (await call('M1', 'group', { group: 'night' })).roster[0].employeeId,
    'P2',
  );
  await assert.rejects(
    call('P1', 'group', { group: 'day' }),
    (e) => e.code === 'permission-denied',
  );
  const employee = env.authenticatedContext('P1', auth('P1').token).firestore();
  await assertSucceeds(
    getDoc(doc(employee, 'preScheduleMonths', monthKey, 'entries', 'P1')),
  );
  await assertFails(
    getDoc(doc(employee, 'preScheduleMonths', monthKey, 'entries', 'P2')),
  );
  await assertFails(
    getDocs(collection(employee, 'preScheduleMonths', monthKey, 'entries')),
  );
  await assertFails(
    setDoc(doc(employee, 'preScheduleMonths', monthKey, 'entries', 'P1'), {
      days,
    }),
  );
  await assertFails(
    getDoc(doc(employee, 'preScheduleMonths', monthKey, 'internal', 'roster')),
  );
});
test('autosave and submit keep one monthly entry, accept edits after submit, reject stale revisions', async () => {
  await assert.rejects(
    call('P1', 'save', {
      days: days.map((v) => (v === '上班' ? '早A1' : v)),
      note: '',
      revision: 0,
    }),
    (e) => e.code === 'invalid-argument',
  );
  await assert.rejects(
    call('P1', 'save', { days, note: '', revision: 0, arrangedDays: days }),
    (e) => e.code === 'permission-denied',
  );
  let result = await call('P1', 'save', {
    days,
    note: '草稿',
    revision: 0,
    employeeId: 'P2',
  });
  assert.equal(result.entry.employeeId, 'P1');
  assert.equal(result.entry.submitted, false);
  result = await call('P1', 'save', {
    days,
    note: '送出',
    revision: 1,
    submit: true,
  });
  assert.equal(result.entry.submitted, true);
  const submittedAt = result.entry.submittedAt;
  result = await call('P1', 'save', { days, note: '送出後修改', revision: 2 });
  assert.equal(result.entry.submittedAt, submittedAt);
  await assert.rejects(
    call('P1', 'save', { days, note: '過期', revision: 0 }),
    (e) => e.code === 'aborted',
  );
  for (const id of ['P2', 'M1', 'A1'])
    await call(id, 'save', { days, note: '', revision: 0, submit: true });
  assert.equal(
    (await db.collection(`preScheduleMonths/${monthKey}/entries`).get()).size,
    4,
  );
  const monitor = env.authenticatedContext('M1', auth('M1').token).firestore();
  assert.equal(
    (
      await assertSucceeds(
        getDocs(
          query(
            collection(monitor, 'preScheduleMonths', monthKey, 'entries'),
            where('group', '==', 'night'),
          ),
        ),
      )
    ).size,
    1,
  );
  await assert.rejects(
    call('M1', 'review', { employeeId: 'P1', days, note: '太早', revision: 3 }),
    (e) => e.code === 'permission-denied',
  );
});
test('cutoff locks employees; monitor edits only pre-schedule with audit, cannot publish', async () => {
  clock += 10000;
  await service.closeExpired();
  assert.equal(
    (await db.doc(`preScheduleMonths/${monthKey}`).get()).data().status,
    'reviewing',
  );
  await assert.rejects(
    call('P1', 'save', { days, note: '截止', revision: 3 }),
    (e) => e.code === 'permission-denied',
  );
  await call('M1', 'review', {
    employeeId: 'P1',
    days,
    note: '監控整理',
    revision: 3,
  });
  assert.equal(
    (await db.collection(`preScheduleMonths/${monthKey}/auditLogs`).get()).size,
    1,
  );
  assert.equal(await formalCount(), 0);
  await assert.rejects(
    call('M1', 'publish', { confirmed: true }),
    (e) => e.code === 'permission-denied',
  );
  await assert.rejects(
    call('M1', 'configure', {
      status: 'open',
      openAt: clock - 1,
      closeAt: clock + 1000,
    }),
    (e) => e.code === 'permission-denied',
  );
});

test('stale summaries, changed employee identities, forged claims and direct writes are rejected', async () => {
  await assert.rejects(
    call('P1', 'save', {
      days,
      note: '舊帳號草稿',
      revision: 4,
      ownerId: 'P2',
    }),
    (e) => e.code === 'permission-denied',
  );
  const summary = await call('A1', 'summary');
  await call('M1', 'review', {
    employeeId: 'P1',
    days,
    note: '更新後需重看摘要',
    revision: 4,
  });
  await assert.rejects(
    call('A1', 'publish', {
      confirmed: true,
      fingerprint: summary.fingerprint,
    }),
    (e) => e.code === 'aborted',
  );
  assert.equal(
    (await db.doc(`preScheduleMonths/${monthKey}`).get()).data().publishJob,
    null,
  );
  await db.doc('employees/P1').update({ title: '調度領班' });
  const changed = await call('A1', 'summary');
  assert.equal(changed.identityConflicts, 1);
  assert.ok(changed.blocking > 0);
  await assert.rejects(
    call('A1', 'publish', {
      confirmed: true,
      fingerprint: changed.fingerprint,
    }),
    (e) => e.code === 'failed-precondition',
  );
  await db.doc('employees/P1').update({ title: '調度專員' });
  await assert.rejects(
    service.handle({
      auth: { uid: 'P1', token: { ...auth('P1').token, role: 'admin' } },
      data: { action: 'summary', monthKey },
    }),
    (e) => e.code === 'permission-denied',
  );
  await assert.rejects(
    service.handle({
      auth: { uid: 'P2', token: auth('P1').token },
      data: { action: 'context', monthKey },
    }),
    (e) => e.code === 'unauthenticated',
  );
  await db.doc('employees/P1').update({ active: false });
  await assert.rejects(
    call('P1', 'context'),
    (e) => e.code === 'permission-denied',
  );
  await db.doc('employees/P1').update({ active: true });
  const admin = env.authenticatedContext('A1', auth('A1').token).firestore();
  await assertFails(
    setDoc(doc(admin, 'preScheduleMonths', monthKey, 'entries', 'P1'), {
      days,
    }),
  );
});
test('unarranged work blocks admin publication; monitor assigns official codes without modifying requests', async () => {
  const summary = await call('A1', 'summary');
  assert.ok(summary.unarrangedWorkDays > 0);
  await assert.rejects(
    call('A1', 'publish', {
      confirmed: true,
      fingerprint: summary.fingerprint,
      acknowledgeWarnings: true,
    }),
    (e) =>
      e.message ===
      `尚有 ${summary.unarrangedWorkDays} 個出勤班次未完成班別／區域安排`,
  );
  assert.equal(await formalCount(), 0);
  for (const code of ['夜ZZ99', '早A1'])
    await assert.rejects(
      call('M1', 'review', {
        employeeId: 'P2',
        arrangedDays: days.map((v) => (v === '上班' ? code : null)),
        note: '',
        revision: 1,
      }),
      (e) => e.code === 'invalid-argument',
    );
  for (const [id] of people) {
    const entry = (
      await db.doc(`preScheduleMonths/${monthKey}/entries/${id}`).get()
    ).data();
    const result = await call('M1', 'review', {
      employeeId: id,
      arrangedDays: days.map((v) =>
        v === '上班' ? (id === 'P2' ? '夜O4' : '早A1') : null,
      ),
      note: '監控完成區域安排',
      revision: entry.revision,
    });
    assert.deepEqual(result.entry.days, days);
    assert.notEqual(result.entry.arrangedDays[0], '上班');
  }
  assert.equal((await call('A1', 'summary')).unarrangedWorkDays, 0);
  assert.equal(await formalCount(), 0);
});

test('publish requires explicit existing-month confirmation; chunk retries are idempotent and audited', async () => {
  await db.doc('scheduleRecords/P1_2026-10-01').set({
    employeeId: 'P1',
    date: '2026-10-01',
    scheduleCode: '早A1',
    createdAt: Timestamp.fromMillis(1),
  });
  let summary = await call('A1', 'summary');
  assert.equal(summary.existingCount, 1);
  await assert.rejects(
    call('A1', 'publish', {
      confirmed: true,
      fingerprint: summary.fingerprint,
    }),
    (e) => e.message.includes('已有正式班表'),
  );
  assert.equal(
    (await db.doc('scheduleRecords/P1_2026-10-01').get()).data().scheduleCode,
    '早A1',
  );
  const job = await call('A1', 'publish', {
    confirmed: true,
    fingerprint: summary.fingerprint,
    overwriteMonth: monthKey,
  });
  await assert.rejects(
    call('M1', 'continue', { jobId: job.jobId, next: 0 }),
    (e) => e.code === 'permission-denied',
  );
  await assert.rejects(
    call('M1', 'review', {
      employeeId: 'P1',
      days,
      note: '發布中',
      revision: 4,
    }),
    (e) => e.code === 'permission-denied',
  );
  const first = await call('A1', 'continue', { jobId: job.jobId, next: 0 });
  assert.equal(first.next, 1);
  assert.equal(first.done, false);
  assert.equal(
    (await db.doc(`preScheduleMonths/${monthKey}`).get()).data().status,
    'reviewing',
  );
  const retry = await call('A1', 'continue', { jobId: job.jobId, next: 0 });
  assert.equal(retry.next, 1);
  assert.equal((await db.collection('scheduleAuditLogs').get()).size, 100);
  await assert.rejects(
    call('A1', 'cancelPreparation'),
    (e) => e.code === 'failed-precondition',
  );
  const result = await call('A1', 'continue', { jobId: job.jobId, next: 1 });
  assert.equal(result.done, true);
  assert.equal(await formalCount(), 124);
  assert.equal((await db.collection('scheduleAuditLogs').get()).size, 124);
  const formal = (await db.doc('scheduleRecords/P2_2026-10-01').get()).data();
  assert.equal(formal.shiftType, 'night');
  assert.equal(formal.scheduleCode, '夜O4');
  assert.equal(formal.employeeName, 'P2');
  assert.equal(
    (await db.doc('scheduleRecords/P1_2026-10-01').get())
      .data()
      .createdAt.toMillis(),
    1,
  );
  assert.equal(
    (await db.doc(`preScheduleMonths/${monthKey}`).get()).data().status,
    'published',
  );
  await assert.rejects(
    call('A1', 'configure', {
      status: 'open',
      openAt: clock - 1,
      closeAt: clock + 1,
    }),
    (e) => e.code === 'failed-precondition',
  );
});

test('a concurrent formal edit pauses publication without overwriting or orphaning an audit', async () => {
  const key = '2026-11',
    invoke = (id, action, extra = {}) =>
      service.handle({
        auth: auth(id),
        data: { monthKey: key, action, ...extra },
      });
  await invoke('A1', 'configure', {
    status: 'open',
    openAt: clock - 1,
    closeAt: clock + 1000,
  });
  const november = days.slice(0, 30);
  for (const [id] of people)
    await invoke(id, 'save', { days: november, note: '', revision: 0 });
  clock += 1000;
  for (const [id] of people)
    await invoke('M1', 'review', {
      employeeId: id,
      arrangedDays: november.map((v) =>
        v === '上班' ? (id === 'P2' ? '夜O4' : '早A1') : null,
      ),
      note: '安排',
      revision: 1,
    });
  const summary = await invoke('A1', 'summary');
  const job = await invoke('A1', 'publish', {
    confirmed: true,
    fingerprint: summary.fingerprint,
    acknowledgeWarnings: true,
  });
  const chunk = (
    await db
      .doc(`preScheduleMonths/${key}/internal/${job.jobId}/chunks/0`)
      .get()
  ).data();
  const target = chunk.items[0].record.id;
  await db
    .doc(`scheduleRecords/${target}`)
    .set({ scheduleCode: '人工既有資料' });
  const count = (await db.collection('scheduleAuditLogs').get()).size;
  await assert.rejects(
    invoke('A1', 'continue', { jobId: job.jobId, next: 0 }),
    (e) => e.code === 'aborted',
  );
  assert.equal(
    (await db.doc(`scheduleRecords/${target}`).get()).data().scheduleCode,
    '人工既有資料',
  );
  assert.equal((await db.collection('scheduleAuditLogs').get()).size, count);
  assert.equal((await invoke('A1', 'progress')).next, 0);
  await invoke('A1', 'cancelPreparation');
  assert.equal(
    (await db.doc(`preScheduleMonths/${key}`).get()).data().publishJob,
    null,
  );
});

test('source groups recover legacy entries in batches without rewriting any saved content or scheduleRecords', async () => {
  const key = '2026-12';
  const ref = db.doc(`preScheduleMonths/${key}`);
  await ref.set({
    monthKey: key,
    status: 'reviewing',
    openAt: Timestamp.fromMillis(clock - 2000),
    closeAt: Timestamp.fromMillis(clock - 1000),
  });
  const roster = [
    { employeeId: 'B0410', name: '測試 PT', title: 'PT-晚夜', group: 'day' },
    { employeeId: '96504', name: '測試 O1', title: '調度專員-N', group: 'day' },
    {
      employeeId: '93900',
      name: '測試主管',
      title: '調度主任',
      group: 'night',
    },
  ];
  await ref.collection('internal').doc('roster').set({ people: roster });
  for (const p of roster)
    await ref
      .collection('entries')
      .doc(p.employeeId)
      .set({
        employeeId: p.employeeId,
        employeeName: p.name,
        jobTitle: p.title,
        group: p.group,
        days,
        arrangedDays: days.map((v) => (v === '上班' ? '夜O4' : null)),
        submitted: true,
        revision: 7,
        note: '保留原內容',
        updatedAt: Timestamp.fromMillis(clock - 999),
      });
  const before = (await ref.collection('entries').get()).docs.map((d) => ({
    id: d.id,
    time: d.updateTime.toMillis(),
    data: d.data(),
  }));
  const officialBefore = await formalCount();
  const getGroup = (group) =>
    service.handle({
      auth: auth('M1'),
      data: { monthKey: key, action: 'group', group },
    });
  const day = await getGroup('day'),
    night = await getGroup('night');
  assert.deepEqual(
    day.roster.map((p) => p.employeeId),
    ['93900'],
  );
  assert.deepEqual(
    night.roster.map((p) => p.employeeId),
    ['96504', 'B0410'],
  );
  assert.equal(day.entries[0].group, 'day');
  assert.ok(
    night.entries.every(
      (e) => e.group === 'night' && e.submitted && e.revision === 7,
    ),
  );
  assert.deepEqual(
    night.entries.find((e) => e.employeeId === '96504').days,
    days,
  );
  await getGroup('day');
  assert.deepEqual(
    (await ref.collection('entries').get()).docs.map((d) => ({
      id: d.id,
      time: d.updateTime.toMillis(),
      data: d.data(),
    })),
    before,
  );
  assert.deepEqual(
    (await ref.collection('internal').doc('roster').get()).data().people,
    roster,
  );
  assert.equal(await formalCount(), officialBefore);
});
