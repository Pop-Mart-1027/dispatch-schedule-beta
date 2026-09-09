import fs from 'node:fs/promises';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-smilebike',
    firestore: {
      rules: await fs.readFile(
        new URL('../firestore.rules', import.meta.url),
        'utf8',
      ),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'employees', 'E001'), {
      employeeId: 'E001',
      name: '一般員工',
      role: 'employee',
      active: true,
      mustChangePassword: false,
    });
    await setDoc(doc(db, 'employees', 'D001'), {
      employeeId: 'D001',
      name: '值班監控',
      role: 'duty',
      active: true,
      mustChangePassword: false,
    });
    await setDoc(doc(db, 'employees', 'A001'), {
      employeeId: 'A001',
      name: '管理員',
      role: 'admin',
      active: true,
      mustChangePassword: false,
    });
    await setDoc(doc(db, 'employees', 'A002'), {
      employeeId: 'A002',
      name: '停用管理員',
      role: 'admin',
      active: false,
      mustChangePassword: false,
    });
    await setDoc(doc(db, 'scheduleRecords', 'E001_2026-09-09'), {
      employeeId: 'E001',
      employeeName: '一般員工',
      date: '2026-09-09',
      scheduleCode: '早A1',
    });
    await setDoc(doc(db, 'dispatchBlocks', '2026-09-09_day_A1'), {
      date: '2026-09-09',
      shiftType: 'day',
      blockId: 'day_A1',
      areaCode: 'A1',
      areaName: '府前 A1區',
      vehicleNo: 'RFM-2661',
      drivers: [],
      stations: [],
      assistants: [],
      workFocus: '',
      balanceArea: '',
      note: '',
      sourceSheet: 'test',
      sourceRow: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      modifiedBy: '',
      modifiedAt: null,
    });
    await setDoc(doc(db, 'broadcasts', 'notice-1'), {
      title: '測試廣播',
      active: true,
    });
    await setDoc(doc(db, 'scheduleSettings', '2026-10'), {
      targetMonth: '2026-10',
      status: 'scheduled',
    });
  });
});

after(async () => environment?.cleanup());

const asRole = (employeeId, role) =>
  environment
    .authenticatedContext(`uid-${employeeId.toLowerCase()}`, {
      employeeId,
      role,
      mustChangePassword: false,
    })
    .firestore();

test('anonymous and inactive accounts cannot enter protected backend data', async () => {
  await assertFails(
    getDocs(
      collection(
        environment.unauthenticatedContext().firestore(),
        'scheduleRecords',
      ),
    ),
  );
  await assertFails(getDocs(collection(asRole('A002', 'admin'), 'employees')));
});

test('employee may read shared operational data but cannot mutate it or employee master', async () => {
  const db = asRole('E001', 'employee');
  assert.equal(
    (await assertSucceeds(getDocs(collection(db, 'employees')))).size,
    4,
  );
  await assertSucceeds(getDocs(collection(db, 'scheduleRecords')));
  await assertSucceeds(getDocs(collection(db, 'dispatchBlocks')));
  await assertSucceeds(getDocs(collection(db, 'broadcasts')));
  await assertFails(
    updateDoc(doc(db, 'scheduleRecords', 'E001_2026-09-09'), {
      scheduleCode: '休',
    }),
  );
  await assertFails(
    updateDoc(doc(db, 'dispatchBlocks', '2026-09-09_day_A1'), {
      vehicleNo: 'X',
    }),
  );
  await assertFails(updateDoc(doc(db, 'employees', 'E001'), { role: 'admin' }));
  await assertFails(getDocs(collection(db, 'scheduleSettings')));
});

test('monitor may edit only dispatch block operational fields', async () => {
  const db = asRole('D001', 'duty');
  await assertSucceeds(getDocs(collection(db, 'scheduleRecords')));
  await assertSucceeds(getDocs(collection(db, 'dispatchBlocks')));
  await assertSucceeds(getDocs(collection(db, 'broadcasts')));
  await assertSucceeds(getDocs(collection(db, 'scheduleSettings')));
  await assertFails(
    updateDoc(doc(db, 'scheduleRecords', 'E001_2026-09-09'), {
      scheduleCode: '休',
    }),
  );
  await assertFails(
    updateDoc(doc(db, 'broadcasts', 'notice-1'), { active: false }),
  );
  await assertFails(updateDoc(doc(db, 'employees', 'E001'), { title: '修改' }));
  await assertSucceeds(
    updateDoc(doc(db, 'dispatchBlocks', '2026-09-09_day_A1'), {
      vehicleNo: 'RFN-1722',
      modifiedBy: 'D001',
      modifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(db, 'dispatchBlocks', '2026-09-09_day_A1'), {
      areaCode: 'A2',
      modifiedBy: 'D001',
      modifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test('admin has schedule, dispatch, broadcast and scheduling-setting management rights', async () => {
  const db = asRole('A001', 'admin');
  await assertSucceeds(
    updateDoc(doc(db, 'scheduleRecords', 'E001_2026-09-09'), {
      scheduleCode: '早A2',
    }),
  );
  await assertSucceeds(
    updateDoc(doc(db, 'dispatchBlocks', '2026-09-09_day_A1'), {
      areaCode: 'A2',
    }),
  );
  await assertSucceeds(
    updateDoc(doc(db, 'broadcasts', 'notice-1'), { active: false }),
  );
  await assertSucceeds(
    updateDoc(doc(db, 'scheduleSettings', '2026-10'), { status: 'open' }),
  );
  await assertFails(updateDoc(doc(db, 'employees', 'E001'), { role: 'admin' }));
  await assertSucceeds(
    setDoc(doc(db, 'scheduleAuditLogs', 'audit-1'), {
      employeeId: 'E001',
      date: '2026-09-09',
      modifiedBy: 'A001',
      modifiedAt: serverTimestamp(),
    }),
  );
});

test('existing breakfast order create rule remains valid', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertSucceeds(
    setDoc(doc(db, 'orders', 'regression'), {
      status: 'new',
      paid: false,
      total: 10,
      paymentMethod: 'cash',
      paymentStatus: 'unpaid',
    }),
  );
});
