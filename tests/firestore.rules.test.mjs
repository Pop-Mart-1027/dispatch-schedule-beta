import fs from 'node:fs/promises';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

let environment;
let moduleServer;

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
    await setDoc(doc(db, 'announcements', 'current'), {
      imageUrl: 'https://example.invalid/notice.png',
      originalName: 'notice.png',
      mediaType: 'image/png',
      originalSize: 123,
      storedBytes: 123,
      width: 100,
      height: 100,
      updatedBy: 'A001',
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'scheduleSettings', '2026-10'), {
      targetMonth: '2026-10',
      status: 'scheduled',
    });
  });
});

after(async () => {await moduleServer?.close();await environment?.cleanup();});

const asRole = (employeeId, role) =>
  environment
    .authenticatedContext(`uid-${employeeId.toLowerCase()}`, {
      employeeId,
      role,
      mustChangePassword: false,
    })
    .firestore();

test('feature settings persist through the real service; only active admin may change boolean flags', async()=>{
  moduleServer=await createServer({configFile:false,logLevel:'error',resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true},optimizeDeps:{noDiscovery:true}});
  const {saveSystemFeature}=await moduleServer.ssrLoadModule('/lib/system-features.ts');
  const admin=asRole('A001','admin'), employee=asRole('E001','employee'), monitor=asRole('D001','duty');
  await assertSucceeds(saveSystemFeature('dispatchEnabled',false,'A001',admin));
  let data=(await assertSucceeds(getDoc(doc(employee,'systemSettings','features')))).data();
  assert.equal(data.dispatchEnabled,false);assert.equal(data.broadcastsEnabled,true);assert.equal(data.attendanceEnabled,false);
  await assertFails(saveSystemFeature('dispatchEnabled',true,'E001',employee));
  await assertFails(saveSystemFeature('dispatchEnabled',true,'D001',monitor));
  await assertFails(saveSystemFeature('dispatchEnabled',true,'A002',asRole('A002','admin')));
  await assertFails(updateDoc(doc(admin,'systemSettings','features'),{dispatchEnabled:'yes',updatedBy:'A001',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(admin,'systemSettings','features'),{dispatchEnabled:true,updatedBy:'someone-else',updatedAt:serverTimestamp()}));
  await Promise.all([saveSystemFeature('attendanceEnabled',true,'A001',admin),saveSystemFeature('broadcastsEnabled',false,'A001',admin)]);
  data=(await getDoc(doc(monitor,'systemSettings','features'))).data();
  assert.equal(data.attendanceEnabled,true);assert.equal(data.broadcastsEnabled,false);assert.equal(data.dispatchEnabled,false);
});

test('formal cell service atomically writes selected record and audit; denies monitor and stale edits', async()=>{
  const {updateFormalScheduleCell}=await moduleServer.ssrLoadModule('/lib/schedule-firestore.ts');
  const admin=asRole('A001','admin'), monitor=asRole('D001','duty');
  const record={id:'E001_2026-09-10_editor',employeeId:'E001',employeeName:'一般員工',date:'2026-09-10',scheduleCode:'夜O1',scheduleLabel:'夜O1',leaveType:''};
  await assertSucceeds(setDoc(doc(admin,'scheduleRecords',record.id),record));
  await assertFails(updateFormalScheduleCell(record,'慰','D001',monitor));
  await assertSucceeds(updateFormalScheduleCell(record,'夜O4','A001',admin));
  const audits=()=>getDocs(collection(admin,'scheduleAuditLogs'));
  let items=(await audits()).docs.filter(doc=>doc.data().recordId===record.id);
  assert.equal(items.length,1);assert.equal(items[0].data().before.scheduleCode,'夜O1');assert.equal(items[0].data().after.scheduleCode,'夜O4');
  assert.equal((await getDoc(doc(admin,'scheduleRecords',record.id))).data().scheduleCode,'夜O4');
  await assert.rejects(updateFormalScheduleCell(record,'病','A001',admin),/已被其他人修改/);
  items=(await audits()).docs.filter(doc=>doc.data().recordId===record.id);assert.equal(items.length,1);
});

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
  await assertSucceeds(getDoc(doc(db, 'announcements', 'current')));
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
  await assertFails(
    setDoc(doc(db, 'dispatchBlocks', '2026-09-10_day_left_1'), {
      date: '2026-09-10',
      shiftType: 'day',
      blockId: '2026-09-10_day_left_1',
      areaCode: 'A1',
      areaName: '府前 A1區',
      variantCode: 'standard',
      vehicleNo: 'RFM-2661',
      vehicleType: '',
      drivers: [],
      stations: [],
      assistants: [],
      workFocus: '',
      balanceArea: '',
      note: '',
      sourceSheet: '班表預覽',
      sourceRow: 1,
      sourceUpdatedAt: null,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      modifiedBy: '',
      modifiedAt: null,
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
  await assertFails(
    updateDoc(doc(db, 'announcements', 'current'), { imageUrl: '' }),
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
  await assertSucceeds(
    setDoc(doc(db, 'dispatchBlocks', '2026-09-10_day_left_1'), {
      date: '2026-09-10',
      shiftType: 'day',
      blockId: '2026-09-10_day_left_1',
      areaCode: 'A1',
      areaName: '府前 A1區',
      variantCode: 'standard',
      vehicleNo: 'RFM-2661',
      vehicleType: '',
      drivers: [{ employeeId: 'D001', employeeName: '值班監控' }],
      stations: [],
      assistants: [],
      workFocus: '',
      balanceArea: '',
      note: '',
      sourceSheet: '班表預覽（block 結構 2026-09-09）',
      sourceRow: 1,
      sourceUpdatedAt: null,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      modifiedBy: 'D001',
      modifiedAt: serverTimestamp(),
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
    setDoc(doc(db, 'announcements', 'current'), {
      imageUrl: 'data:image/webp;base64,AA==',
      originalName: 'new.png',
      mediaType: 'image/webp',
      originalSize: 200,
      storedBytes: 28,
      width: 100,
      height: 100,
      updatedBy: 'A001',
      updatedAt: serverTimestamp(),
    }),
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

test('breakfast order collections are excluded from the independent project', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(db, 'orders', 'regression'), {
      status: 'new',
      paid: false,
      total: 10,
      paymentMethod: 'cash',
      paymentStatus: 'unpaid',
    }),
  );
});

test('dispatch day/version saves are atomic, future-only, immutable and admin-controlled', async()=>{
  const {saveDispatchConfiguration,configuredDispatchBlocks,dispatchToday,followingDate}=await moduleServer.ssrLoadModule('/lib/dispatch-configuration.ts');
  const admin=asRole('A001','admin'), employee=asRole('E001','employee'), duty=asRole('D001','duty');
  const date=dispatchToday(),future=followingDate(date),later=followingDate(future);
  const id=`${date}_night_config-test`;
  const block={id,blockId:id,date,shiftType:'night',areaCode:'O1',areaName:'原區域',variantCode:'standard',vehicleNo:'OLD-CAR',vehicleType:'',drivers:[],stations:[],assistants:[],workFocus:'原工作',balanceArea:'',note:'',sourceSheet:'test',sourceRow:1,status:'preview',modifiedBy:'',modifiedAt:null};
  const values={areaName:'臨時名稱',vehicleNo:'TEMP-CAR',drivers:[],stations:[],assistants:[],workFocus:'臨時工作',balanceArea:'',note:''};
  await assertFails(saveDispatchConfiguration({block,values,blocks:[block],mode:'day',employeeId:'E001'},employee));
  assert.equal((await getDoc(doc(admin,'dispatchConfiguration','base'))).exists(),false);
  await assertSucceeds(saveDispatchConfiguration({block,values,blocks:[block],mode:'day',employeeId:'A001'},admin));
  let day=(await getDoc(doc(admin,'dispatchBlocks',id))).data();
  assert.equal(day.vehicleNo,'TEMP-CAR');assert.equal(day.modifiedBy,'A001');
  assert.equal((await configuredDispatchBlocks(future,[],employee))[0].vehicleNo,'OLD-CAR');
  const originalFuture={...block,id:`${future}_night_config-test`,blockId:`${future}_night_config-test`,date:future,vehicleNo:'EXISTING-AUTO'};
  assert.equal((await configuredDispatchBlocks(future,[originalFuture],employee))[0].vehicleNo,'EXISTING-AUTO');
  const versionsBefore=(await getDocs(collection(admin,'dispatchConfigurationVersions'))).size;
  await assertFails(saveDispatchConfiguration({block:{id,...day},values,blocks:[block],mode:'version',employeeId:'D001'},duty));
  assert.equal((await getDocs(collection(admin,'dispatchConfigurationVersions'))).size,versionsBefore);
  await assertSucceeds(saveDispatchConfiguration({block:{id,...day},values:{...values,areaName:'新版區域',vehicleNo:'NEW-CAR',stations:[{employeeId:'E001',employeeName:'支援'}]},blocks:[block],mode:'version',employeeId:'A001'},admin));
  const futureBlock=(await configuredDispatchBlocks(future,[],employee))[0];
  assert.equal(futureBlock.vehicleNo,'NEW-CAR');assert.equal(futureBlock.areaName,'新版區域');
  assert.equal(futureBlock.stations[0].employeeId,'E001');assert.equal(futureBlock.modifiedBy,'A001');
  assert.equal((await configuredDispatchBlocks(later,[],employee))[0].vehicleNo,'NEW-CAR');
  const manual={...originalFuture,vehicleNo:'MANUAL-CAR',modifiedBy:'D001'};
  assert.deepEqual((await configuredDispatchBlocks(future,[manual],employee))[0],manual);
  const historical={...block,date:'2020-01-01'};
  assert.deepEqual(await configuredDispatchBlocks('2020-01-01',[historical],employee),[historical]);
  const {listDispatchBlockTemplate}=await moduleServer.ssrLoadModule('/lib/dispatch-blocks-firestore.ts');
  assert.deepEqual(await listDispatchBlockTemplate('2020-01-01',employee),{sourceDate:'',blocks:[]});
  const versions=await getDocs(collection(admin,'dispatchConfigurationVersions'));
  const version=versions.docs.at(-1),audit=(await getDoc(doc(admin,'dispatchAuditLogs',version.data().auditId))).data();
  assert.equal(audit.mode,'version');assert.equal(audit.effectiveFrom,future);assert.equal(audit.before.vehicleNo,'TEMP-CAR');assert.equal(audit.after.vehicleNo,'NEW-CAR');
  await assertFails(updateDoc(version.ref,{effectiveFrom:date}));
  await assertFails(updateDoc(doc(admin,'dispatchConfiguration','base'),{activeFrom:'2020-01-01'}));
  await assert.rejects(saveDispatchConfiguration({block:historical,values,blocks:[historical],mode:'version',employeeId:'A001'},admin),/歷史/);
  // Stale editor must not overwrite a newer manual save or leave a stray audit/version.
  await assert.rejects(saveDispatchConfiguration({block,values,blocks:[block],mode:'day',employeeId:'A001'},admin),/其他人修改/);
})
