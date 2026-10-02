import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleSheetSync, SCHEDULE_SYNC_SCHEMA_VERSION } from './schedule-sheet-service.mjs';
import { digest, parseScheduleSheet } from './schedule-sheet-domain.mjs';

const employee = { name: '測試人員', active: true };
const employeeId = 'B9999';
const section = { key: 'area:S', group: 'day', section: 'S區', areaCode: 'S', label: 'S區' };
const row = { employeeId, group: 'day', section: 'S區', areaCode: 'S', blankDays: [] };

class FakeTimestamp {
  constructor(milliseconds) { this.milliseconds = milliseconds; }
  toDate() { return new Date(this.milliseconds); }
}

function csv(month, year = 2026) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [
    ['', year, month],
    ['', '', '', '', ...Array.from({ length: days }, (_, day) => `${month}月${day + 1}日`)],
    ['區域', '職務名稱', '員工編號', '姓名'],
    ['', 'S區-ABC-1234', '', '', ...Array(days).fill('')],
    ['', '調度專員', employeeId, employee.name, ...Array(days).fill('早S')],
  ].map(values => values.join(',')).join('\n');
}

function fixtures() {
  // Ignore previous-year tabs while a new month is published.
  return new Map([
    ['9月日班', csv(9, 2025)],
    ['9月夜班', csv(9, 2025)],
    ['10月日班', csv(10)],
  ]);
}

function sourceRows(sheets) {
  return [...sheets].flatMap(([title, contents], gid) => {
    const month = Number(title.match(/^(\d+)月/)[1]);
    return parseScheduleSheet(contents, {
      gid: String(gid), title, month: `2026-${String(month).padStart(2, '0')}`,
      group: title.includes('日班') ? 'day' : 'night',
    }) || [];
  });
}

function currentLayout(extra = {}) {
  return { monthKey: '2026-10', revision: 4, rows: [structuredClone(row)], sections: [section], excludedEmployeeIds: [], ...extra };
}

function setup({ control = {}, layout, withEmployee = true, sheets = fixtures(), records = [], provisionEmployee, failEmployeeWrites = 0, beforeQueryRead, beforeGetAll } = {}) {
  const saved = new Map([['scheduleSheetSync/control', { enabled: true, ...control }]]);
  if (withEmployee) saved.set(`employees/${employeeId}`, employee);
  if (layout) saved.set('scheduleMonthLayouts/2026-10', layout);
  for (const record of records) saved.set(`scheduleRecords/${record.id}`, record);
  const stats = { queryReads: 0, fetches: 0, commits: 0 };
  const snapshot = reference => {
    const value = saved.get(reference.path);
    return { id: reference.id, exists: value !== undefined, data: () => value, ref: reference };
  };
  const collection = path => {
    const query = (filters = []) => ({
      where: (field, operator, value) => query([...filters, { field, operator, value }]),
      get: async () => {
        await beforeQueryRead?.({ collection: path, saved });
        stats.queryReads++;
        const docs = [...saved].filter(([key, value]) => {
          if (!key.startsWith(`${path}/`) || key.slice(path.length + 1).includes('/')) return false;
          return filters.every(filter => {
            assert.equal(filter.operator, '>=');
            return value[filter.field] >= filter.value;
          });
        }).map(([key]) => snapshot(reference(key)));
        return { docs };
      },
    });
    return { ...query(), doc: id => reference(`${path}/${id}`) };
  };
  const reference = path => ({
    path, id: path.split('/').at(-1),
    get: async () => snapshot(reference(path)),
    update: async values => {
      assert.ok(saved.has(path), `Missing document ${path}`);
      saved.set(path, { ...saved.get(path), ...values });
    },
    set: async (values, options) => saved.set(path, options?.merge ? { ...saved.get(path), ...values } : values),
    collection: name => collection(`${path}/${name}`),
  });
  const db = {
    collection,
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        get: async ref => snapshot(ref),
        getAll: async (...refs) => {
          await beforeGetAll?.({ refs, saved });
          return refs.map(snapshot);
        },
        update: (ref, values) => {
          assert.ok(saved.has(ref.path), `Missing document ${ref.path}`);
          writes.push({ ref, values, merge: true });
        },
        set: (ref, values, options) => writes.push({ ref, values, merge: options?.merge }),
      });
      if (failEmployeeWrites > 0 && writes.some(write => write.ref.path.startsWith('employees/'))) {
        failEmployeeWrites--;
        throw Error('simulated employee commit failure');
      }
      for (const { ref, values, merge } of writes) saved.set(ref.path, merge ? { ...saved.get(ref.path), ...values } : values);
      stats.commits++;
      return result;
    },
  };
  const fetch = async url => {
    stats.fetches++;
    if (url.endsWith('/htmlview')) return {
      ok: true,
      text: async () => [...sheets.keys()].map((title, gid) => `items.push({name: "${title}", pageUrl: "url", gid: "${gid}"`).join(';'),
    };
    const gid = Number(new URL(url).searchParams.get('gid'));
    const contents = [...sheets.values()][gid];
    assert.ok(contents, `Unknown sheet ${gid}`);
    return { ok: true, text: async () => contents };
  };
  const service = createScheduleSheetSync({ db, FieldValue: { serverTimestamp: () => new FakeTimestamp(1790899200000) }, fetch, provisionEmployee, now: () => new Date('2026-10-02T11:30:00.000Z') });
  return { saved, stats, sheets, service };
}

void test('same source hash is re-planned after a sync schema upgrade', async () => {
  for (const sourceSchemaVersion of [undefined, SCHEDULE_SYNC_SCHEMA_VERSION - 1]) {
    const sheets = fixtures();
    const sourceHash = digest(sourceRows(sheets));
    const { saved, stats, service } = setup({ sheets, layout: currentLayout(), control: { sourceHash, sourceSchemaVersion, lastResult: { issueCount: 0 } } });
    const result = await service.run();
    assert.equal(result.changed, 31);
    assert.equal(stats.queryReads, 3);
    const control = saved.get('scheduleSheetSync/control');
    assert.equal(control.sourceHash, sourceHash);
    assert.equal(control.sourceSchemaVersion, SCHEDULE_SYNC_SCHEMA_VERSION);
    assert.equal(control.leaseUntil, 0);
    assert.equal(saved.get(`scheduleRecords/${employeeId}_2026-10-31`).scheduleCode, '早S');
  }
});

void test('unresolved employees are retried without requiring a sheet change', async () => {
  const { saved, stats, service } = setup({ layout: currentLayout(), withEmployee: false });
  const first = await service.run();
  assert.equal(first.changed, 0);
  assert.equal(first.issueCount, 1);
  const previousHash = saved.get('scheduleSheetSync/control').sourceHash;
  saved.set(`employees/${employeeId}`, employee);
  saved.set('scheduleSheetSync/control', { ...saved.get('scheduleSheetSync/control'), nextIssueRetryAt: 0 });
  const second = await service.run();
  assert.equal(second.changed, 31);
  assert.equal(second.issueCount, 0);
  assert.equal(stats.queryReads, 6);
  assert.equal(saved.get('scheduleSheetSync/control').sourceHash, previousHash);
  assert.equal(saved.get('scheduleSheetSync/control').lastResult.issueCount, 0);
});

void test('unchanged current-version source checks only layout order and clears a stale error', async () => {
  const sheets = fixtures();
  const lastSuccessAt = new FakeTimestamp(1000);
  const { saved, stats, service } = setup({ sheets, control: {
    sourceHash: digest(sourceRows(sheets)), sourceSchemaVersion: SCHEDULE_SYNC_SCHEMA_VERSION,
    lastResult: { changed: 31, issueCount: 0 }, lastError: '試算表讀取失敗 HTTP 503', lastSuccessAt,
  } });
  assert.deepEqual(await service.run(), { unchanged: true });
  assert.equal(stats.queryReads, 1);
  const control = saved.get('scheduleSheetSync/control');
  assert.equal(control.lastError, '');
  assert.equal(control.leaseUntil, 0);
  assert.equal(control.lastSuccessAt, lastSuccessAt);
  assert.equal([...saved.keys()].filter(path => path.startsWith('scheduleSheetSyncRuns/')).length, 0);
});

function splitAreaLayout() {
  const area = code => ({ key: `area:${code}`, group: 'night', section: `${code}區`, areaCode: code, label: `${code}區自訂標題` });
  const placement = (id, code, blankDays = []) => ({ employeeId: id, group: 'night', sectionKey: `area:${code}`, section: `${code}區`, areaCode: code, blankDays });
  return currentLayout({
    sections: [area('O1'), area('R1'), area('O4')],
    rows: [placement(employeeId, 'O1', ['1']), placement('B8002', 'R1'), placement('B8003', 'O4'), placement('B8004', 'O1', ['7'])],
    excludedEmployeeIds: ['B7000'], assignmentResetAt: { [employeeId]: 'keep reset' },
    createdAt: new FakeTimestamp(2000), customMetadata: 'keep metadata',
  });
}

void test('every unchanged-source run repairs separated areas without touching people, codes or highlight dates', async () => {
  const sheets = fixtures();
  const layout = splitAreaLayout();
  const previousIssue = { reason: 'unmapped-source-area', employeeId: 'B7000' };
  let provisions = 0;
  const { saved, stats, service } = setup({ sheets, layout, provisionEmployee: async () => provisions++,
    records: [{ id: 'keep-record', employeeId, date: '2026-10-01', scheduleCode: '休', note: 'keep note' }],
    control: { sourceHash: digest(sourceRows(sheets)), sourceSchemaVersion: SCHEDULE_SYNC_SCHEMA_VERSION,
      lastResult: { issues: [previousIssue], issueCount: 120 }, nextIssueRetryAt: Date.now() + 600000 },
  });
  const person = { ...employee, onboardingStartedAt: '2026-10-02T11:30:00.000Z', onboardingHighlightUntil: '2027-01-02T11:30:00.000Z' };
  saved.set(`employees/${employeeId}`, person);
  const record = saved.get('scheduleRecords/keep-record');
  const result = await service.run();
  assert.equal(result.orderingOnly, true);
  assert.equal(result.layouts, 1);
  assert.equal(result.changed, 0);
  assert.equal(result.createdEmployees, 0);
  assert.equal(result.issueCount, 120);
  assert.deepEqual(result.issues, [previousIssue]);
  const sorted = saved.get('scheduleMonthLayouts/2026-10');
  assert.deepEqual(sorted.sections.map(s => s.key), ['area:O1', 'area:O4', 'area:R1']);
  assert.deepEqual(sorted.rows.map(r => r.employeeId), [employeeId, 'B8004', 'B8003', 'B8002']);
  for (const original of layout.rows) assert.deepEqual(sorted.rows.find(r => r.employeeId === original.employeeId), original);
  for (const original of layout.sections) assert.deepEqual(sorted.sections.find(s => s.key === original.key), original);
  assert.equal(sorted.createdAt, layout.createdAt);
  assert.equal(sorted.customMetadata, layout.customMetadata);
  assert.deepEqual(sorted.assignmentResetAt, layout.assignmentResetAt);
  assert.deepEqual(sorted.excludedEmployeeIds, layout.excludedEmployeeIds);
  assert.equal(saved.get(`employees/${employeeId}`), person);
  assert.equal(saved.get('scheduleRecords/keep-record'), record);
  assert.equal(provisions, 0);
  assert.equal(stats.queryReads, 1);
  assert.equal(sorted.revision, 5);
  const log = [...saved.entries()].find(([path]) => path.includes('/changes/scheduleMonthLayouts_2026-10'))?.[1];
  assert.deepEqual(log.before.rows, layout.rows);
  assert.deepEqual(log.after.rows, sorted.rows);
  assert.deepEqual(await service.run(), { unchanged: true });
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').revision, 5);
  // A later app layout update must be checked even though the sheet hash is identical.
  saved.set('scheduleMonthLayouts/2026-10', { ...sorted, rows: layout.rows, sections: layout.sections, revision: 6 });
  assert.equal((await service.run()).layouts, 1);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').revision, 7);
  assert.deepEqual(saved.get('scheduleMonthLayouts/2026-10').sections, sorted.sections);
  assert.equal(saved.get(`employees/${employeeId}`), person);
  assert.equal(saved.get('scheduleRecords/keep-record'), record);
  assert.equal(provisions, 0);
  assert.equal(stats.queryReads, 3);
});

void test('layout checks are limited to months present in the valid sheet source', async () => {
  const sheets = fixtures();
  const { saved, service } = setup({ sheets, layout: currentLayout(),
    control: { sourceHash: digest(sourceRows(sheets)), sourceSchemaVersion: SCHEDULE_SYNC_SCHEMA_VERSION },
  });
  const futureLayout = { ...splitAreaLayout(), monthKey: '2026-11' };
  saved.set('scheduleMonthLayouts/2026-11', futureLayout);
  assert.deepEqual(await service.run(), { unchanged: true });
  assert.equal(saved.get('scheduleMonthLayouts/2026-11'), futureLayout);
});

void test('an ordering repair does not overwrite a concurrent month layout revision', async () => {
  const sheets = fixtures();
  let intervene = true;
  const { saved, service } = setup({ sheets, layout: splitAreaLayout(),
    control: { sourceHash: digest(sourceRows(sheets)), sourceSchemaVersion: SCHEDULE_SYNC_SCHEMA_VERSION },
    beforeGetAll: ({ saved: state }) => {
      if (!intervene) return;
      intervene = false;
      const previous = state.get('scheduleMonthLayouts/2026-10');
      state.set('scheduleMonthLayouts/2026-10', { ...previous, revision: 5, customMetadata: 'concurrent edit' });
    },
  });
  await assert.rejects(service.run(), /月份配置已被修改/);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').revision, 5);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').customMetadata, 'concurrent edit');
  assert.deepEqual(saved.get('scheduleMonthLayouts/2026-10').sections.map(s => s.key), ['area:O1', 'area:R1', 'area:O4']);
  assert.equal(saved.get('scheduleSheetSync/control').leaseUntil, 0);
  assert.equal((await service.run()).orderingOnly, true);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').revision, 6);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').customMetadata, 'concurrent edit');
});

void test('pausing sync after layout reads prevents an unchanged-source ordering write', async () => {
  const sheets = fixtures();
  const layout = splitAreaLayout();
  const { saved, service } = setup({ sheets, layout,
    control: { sourceHash: digest(sourceRows(sheets)), sourceSchemaVersion: SCHEDULE_SYNC_SCHEMA_VERSION },
    beforeQueryRead: ({ collection, saved: state }) => {
      if (collection === 'scheduleMonthLayouts') state.set('scheduleSheetSync/control', { ...state.get('scheduleSheetSync/control'), enabled: false });
    },
  });
  await assert.rejects(service.run(), /同步已暫停/);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10'), layout);
  assert.equal(saved.get('scheduleSheetSync/control').enabled, false);
  assert.equal(saved.get('scheduleSheetSync/control').leaseUntil, 0);
});

void test('new October, November and December sheets create their own complete month schedules', async () => {
  const { saved, sheets, service } = setup();
  for (const [month, days] of [[10, 31], [11, 30], [12, 31]]) {
    if (month !== 10) sheets.set(`${month}月日班`, csv(month));
    const result = await service.run();
    assert.equal(result.changed, days);
    assert.equal(result.layouts, 1);
    assert.equal(result.issueCount, 0);
    const monthKey = `2026-${month}`;
    const layout = saved.get(`scheduleMonthLayouts/${monthKey}`);
    assert.equal(layout.rows.length, 1);
    assert.equal(layout.rows[0].employeeId, employeeId);
    assert.equal(layout.rows[0].areaCode, 'S');
    assert.equal(layout.revision, 1);
    for (let day = 1; day <= days; day++) {
      const date = `${monthKey}-${String(day).padStart(2, '0')}`;
      const record = saved.get(`scheduleRecords/${employeeId}_${date}`);
      assert.equal(record.date, date);
      assert.equal(record.scheduleCode, '早S');
      assert.equal(record.shiftType, 'morning');
      assert.equal(record.modifiedBy, 'google-schedule-sync');
    }
  }
  assert.equal([...saved.keys()].filter(path => path.startsWith('scheduleRecords/')).length, 92);
  assert.deepEqual(await service.run(), { unchanged: true });
});

void test('a previously synced empty month is repaired with sections even when the source hash is unchanged', async () => {
  const sheets = fixtures();
  const createdAt = new FakeTimestamp(2000);
  const { saved, service } = setup({ sheets,
    layout: { monthKey: '2026-10', revision: 1, rows: [], excludedEmployeeIds: [], modifiedBy: 'google-schedule-sync', createdAt },
    control: { sourceHash: digest(sourceRows(sheets)), lastResult: { changed: 0, issueCount: 1 } },
  });
  const result = await service.run();
  assert.equal(result.changed, 31);
  assert.equal(result.layouts, 1);
  assert.equal(result.issueCount, 0);
  const layout = saved.get('scheduleMonthLayouts/2026-10');
  assert.equal(layout.rows[0].employeeId, employeeId);
  assert.equal(layout.sections.length, 1);
  assert.equal(layout.sections[0].areaCode, 'S');
  assert.equal(layout.sections[0].group, 'day');
  assert.equal(layout.revision, 2);
  assert.equal(layout.createdAt, createdAt);
});

void test('month and existing-record metadata survives a schema-triggered re-plan', async () => {
  const createdAt = new FakeTimestamp(2000);
  const modifiedAt = new FakeTimestamp(3000);
  const sheets = fixtures();
  const { saved, service } = setup({
    sheets,
    control: { sourceHash: digest(sourceRows(sheets)), sourceSchemaVersion: SCHEDULE_SYNC_SCHEMA_VERSION - 1, lastResult: { issueCount: 0 } },
    layout: currentLayout({ createdAt, modifiedAt, customMetadata: 'keep', rows: [{ ...row, blankDays: ['1'] }] }),
    records: [{ id: 'custom-record', employeeId, date: '2026-10-01', scheduleCode: '休', note: 'keep note', vehicle: 'keep vehicle', createdAt }],
  });
  const result = await service.run();
  assert.equal(result.layouts, 1);
  const layout = saved.get('scheduleMonthLayouts/2026-10');
  assert.equal(layout.createdAt, createdAt);
  assert.equal(layout.modifiedAt, modifiedAt);
  assert.equal(layout.customMetadata, 'keep');
  assert.equal(layout.sections[0].key, section.key);
  assert.equal(layout.revision, 5);
  assert.deepEqual(layout.rows[0].blankDays, []);
  const record = saved.get('scheduleRecords/custom-record');
  assert.equal(record.note, 'keep note');
  assert.equal(record.vehicle, 'keep vehicle');
  assert.equal(record.createdAt, createdAt);
  assert.equal(record.scheduleCode, '早S');
});

void test('paused sync and an active lease perform no source reads or schedule writes', async () => {
  for (const control of [{ enabled: false }, { leaseUntil: Date.now() + 60000 }]) {
    const { saved, stats, service } = setup({ control });
    assert.deepEqual(await service.run(), { skipped: true });
    assert.equal(stats.fetches, 0);
    assert.equal(stats.queryReads, 0);
    assert.equal(saved.size, 2);
  }
});

void test('October still syncs after September tabs are removed', async () => {
  const { saved, sheets, service } = setup();
  sheets.delete('9月日班');
  sheets.delete('9月夜班');
  const result = await service.run();
  assert.equal(result.changed, 31);
  assert.equal(result.issueCount, 0);
  assert.equal(saved.get('scheduleMonthLayouts/2026-10').rows.length, 1);
});

void test('a source containing only previous-year rosters cannot be marked synced', async () => {
  const { saved, sheets, service } = setup();
  sheets.delete('10月日班');
  await assert.rejects(service.run(), /2026 年的有效班表/);
  const control = saved.get('scheduleSheetSync/control');
  assert.equal(control.sourceHash, undefined);
  assert.equal(control.leaseUntil, 0);
  assert.match(control.lastError, /2026 年的有效班表/);
  assert.equal([...saved.keys()].filter(path => path.startsWith('scheduleRecords/')).length, 0);
});

void test('pending issues do not re-read the full app roster every minute, but new sheets sync immediately', async () => {
  const { saved, stats, sheets, service } = setup({ withEmployee: false });
  assert.equal((await service.run()).issueCount, 1);
  assert.ok(saved.get('scheduleSheetSync/control').nextIssueRetryAt > Date.now());
  assert.deepEqual(await service.run(), { unchanged: true });
  assert.equal(stats.queryReads, 4);
  sheets.set('11月日班', csv(11));
  assert.equal((await service.run()).issueCount, 2);
  assert.equal(stats.queryReads, 7);
});

void test('new employees are provisioned and appended to their source area in the same automatic run', async () => {
  const provisions = [];
  const createdAt = new FakeTimestamp(1000);
  const layout = currentLayout({ rows: [{ ...row, employeeId: 'B8888' }], createdAt, customMetadata: 'keep' });
  const { saved, service } = setup({ withEmployee: false, layout, provisionEmployee: async (candidate, context) => provisions.push({ candidate, context }) });
  saved.set('employees/B8888', { ...employee, name: '原有人員', role: 'admin', mustChangePassword: false });
  const result = await service.run();
  assert.equal(result.createdEmployees, 1);
  assert.equal(result.changed, 31);
  assert.equal(result.issueCount, 0);
  assert.equal(provisions.length, 1);
  assert.ok(provisions[0].context.runId);
  const newcomer = saved.get(`employees/${employeeId}`);
  assert.equal(newcomer.role, 'employee');
  assert.equal(newcomer.active, true);
  assert.equal(newcomer.mustChangePassword, true);
  assert.equal(newcomer.section, 'S區');
  assert.equal(newcomer.onboardingStartedAt, '2026-10-02T11:30:00.000Z');
  assert.equal(newcomer.onboardingHighlightUntil, '2027-01-02T11:30:00.000Z');
  const nextLayout = saved.get('scheduleMonthLayouts/2026-10');
  assert.deepEqual(nextLayout.rows.map(r => r.employeeId), ['B8888', employeeId]);
  assert.equal(nextLayout.createdAt, createdAt);
  assert.equal(nextLayout.customMetadata, 'keep');
  assert.equal(saved.get('employees/B8888').role, 'admin');
  const before = newcomer;
  assert.deepEqual(await service.run(), { unchanged: true });
  assert.equal(saved.get(`employees/${employeeId}`), before);
  assert.equal(provisions.length, 1);
  assert.equal([...saved.keys()].filter(path => path.startsWith('auditLogs/schedule_employee_')).length, 1);
});

void test('a new source employee can create the missing G area without replacing custom labels or metadata', async () => {
  const sheets = fixtures();
  sheets.set('10月日班', csv(10).replace('S區-ABC-1234', 'G區-ABC-1234').replaceAll('早S', '早G'));
  const renamed = { ...section, label: '管理員原標題' };
  const { saved, service } = setup({ sheets, withEmployee: false, layout: currentLayout({ rows: [{ ...row, employeeId: 'B8888' }], sections: [renamed] }), provisionEmployee: async () => ({ created: true }) });
  assert.equal((await service.run()).createdEmployees, 1);
  const layout = saved.get('scheduleMonthLayouts/2026-10');
  assert.equal(layout.sections[0].label, '管理員原標題');
  assert.equal(layout.sections[1].areaCode, 'G');
  assert.equal(layout.rows.find(r => r.employeeId === employeeId).areaCode, 'G');
  assert.equal(saved.get(`scheduleRecords/${employeeId}_2026-10-01`).scheduleCode, '早G');
});

void test('preview projects new employees but never creates an account or writes employee data', async () => {
  let provisions = 0;
  const { saved, service } = setup({ withEmployee: false, provisionEmployee: async () => provisions++ });
  const originalSize = saved.size;
  const result = await service.handle({ action: 'preview' });
  assert.equal(result.createdEmployees, 1);
  assert.equal(result.changed, 31);
  assert.equal(result.issueCount, 0);
  assert.equal(provisions, 0);
  assert.equal(saved.size, originalSize);
});

void test('Auth completion followed by a failed employee transaction can retry without resetting the account', async () => {
  const authUsers = new Set();
  let accountCreates = 0, provisions = 0;
  const { saved, service } = setup({ withEmployee: false, failEmployeeWrites: 1, provisionEmployee: async candidate => {
    provisions++;
    if (!authUsers.has(candidate.employeeId)) { authUsers.add(candidate.employeeId); accountCreates++; }
    return { created: accountCreates === 1, reused: provisions > 1 };
  } });
  await assert.rejects(service.run(), /simulated employee commit failure/);
  assert.equal(saved.has(`employees/${employeeId}`), false);
  assert.equal(saved.get('scheduleSheetSync/control').sourceSchemaVersion, undefined);
  assert.equal(saved.get('scheduleSheetSync/control').leaseUntil, 0);
  const result = await service.run();
  assert.equal(result.createdEmployees, 1);
  assert.equal(result.changed, 31);
  assert.equal(accountCreates, 1);
  assert.equal(provisions, 2);
  assert.equal(saved.get(`employees/${employeeId}`).onboardingHighlightUntil, '2027-01-02T11:30:00.000Z');
});

void test('existing inactive staff and auth conflicts never create schedule rows or reactivate accounts', async () => {
  let provisions = 0;
  const inactive = setup({ provisionEmployee: async () => provisions++ });
  inactive.saved.set(`employees/${employeeId}`, { ...employee, active: false, role: 'admin', mustChangePassword: false });
  const result = await inactive.service.run();
  assert.equal(result.createdEmployees, 0);
  assert.equal(result.changed, 0);
  assert.equal(provisions, 0);
  assert.equal(inactive.saved.get(`employees/${employeeId}`).active, false);
  assert.equal(inactive.saved.get(`employees/${employeeId}`).role, 'admin');
  const conflicting = setup({ withEmployee: false, provisionEmployee: async () => {
    const error = Error('existing login account'); error.code = 'auth-account-conflict'; throw error;
  } });
  const conflict = await conflicting.service.run();
  assert.equal(conflict.changed, 0);
  assert.equal(conflict.createdEmployees, 0);
  assert.equal(conflict.issueCount, 1);
  assert.equal(conflict.issues[0].reason, 'auth-account-conflict');
  assert.equal(conflicting.saved.has(`employees/${employeeId}`), false);
});

void test('bulk clearing guard runs before provisioning any new account', async () => {
  const sheets = fixtures();
  const existingPeople = ['B8001', 'B8002', 'B8003', 'B8004'];
  const emptyRows = existingPeople.map(id => ['', '調度專員', id, '原有人員', ...Array(31).fill('')].join(',')).join('\n');
  sheets.set('10月日班', `${csv(10)}\n${emptyRows}`);
  const records = existingPeople.flatMap(id => Array.from({ length: 31 }, (_, day) => ({ id: `${id}_${day}`, employeeId: id, date: `2026-10-${String(day + 1).padStart(2, '0')}`, scheduleCode: '早S' })));
  let provisions = 0;
  const { saved, service } = setup({ sheets, withEmployee: false, records, layout: currentLayout({ rows: existingPeople.map(id => ({ ...row, employeeId: id })) }), provisionEmployee: async () => provisions++ });
  existingPeople.forEach(id => saved.set(`employees/${id}`, { ...employee, name: '原有人員' }));
  await assert.rejects(service.run(), /清空 124 格/);
  assert.equal(provisions, 0);
  assert.equal(saved.has(`employees/${employeeId}`), false);
});

void test('concurrent ordinary employee creation cannot bypass the actual-plan bulk clearing guard', async () => {
  const ids = [employeeId, 'B9001', 'B9002', 'B9003'];
  const sheets = fixtures();
  for (const month of [9, 10]) {
    const days = month === 9 ? 30 : 31;
    const contents = csv(month).split('\n');
    contents.pop();
    for (const id of ids) contents.push(['', '調度專員', id, employee.name, ...Array(days).fill(month === 9 ? '' : '早S')].join(','));
    sheets.set(`${month}月日班`, contents.join('\n'));
  }
  const records = ids.flatMap(id => Array.from({ length: 30 }, (_, day) => ({ id: `${id}_${day}`, employeeId: id, date: `2026-09-${String(day + 1).padStart(2, '0')}`, scheduleCode: '早S' })));
  const { saved, service } = setup({ sheets, withEmployee: false, records, provisionEmployee: async candidate => {
    saved.set(`employees/${candidate.employeeId}`, { ...employee, role: 'employee' });
  } });
  saved.set('scheduleMonthLayouts/2026-09', { ...currentLayout(), monthKey: '2026-09', rows: ids.map(id => ({ ...row, employeeId: id })) });
  await assert.rejects(service.run(), /清空 120 格/);
  assert.equal(saved.get(`scheduleRecords/${employeeId}_0`).scheduleCode, '早S');
  assert.equal([...saved.keys()].filter(path => path.startsWith('scheduleRecords/') && saved.get(path).date.startsWith('2026-10')).length, 0);
});
