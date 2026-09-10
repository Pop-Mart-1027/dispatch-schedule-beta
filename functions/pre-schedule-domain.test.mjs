import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionPublicationItems } from './pre-schedule-service.mjs';
import {
  PRE_CHOICES,
  monthDays,
  assessDays,
  assessArrangement,
  reviewedDays,
  preScheduleGroup,
  effectiveMonthStatus,
  mayEmployeeEdit,
  mayReview,
  publicationSummary,
  toFormalRecords,
} from './pre-schedule-domain.mjs';
const month = '2026-10';
const catalog = {
  day: ['早A1', '早監'],
  night: ['夜O4', '小夜O1', '夜監', '國上夜監'],
};

test('large 750-person publication manifests stay below document and transaction limits', () => {
  const items = Array.from({ length: 750 * 31 }, (_, i) => ({
    record: { employeeId: `TEST${i}`, note: '備'.repeat(2000) },
    before: { note: '舊'.repeat(2000) },
    expected: null,
  }));
  const chunks = partitionPublicationItems(items);
  assert.equal(chunks.flat().length, 23250);
  assert.ok(chunks.length > 233);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify({ items: chunk })) < 500000);
  }
  assert.throws(() =>
    partitionPublicationItems([{ note: '超'.repeat(200000) }]),
  );
});
const days = Array.from(
  { length: 31 },
  (_, i) =>
    ['例', '休', '上班', '上班', '上班', '上班', '上班'][
      new Date(
        `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      ).getUTCDay()
    ],
);
test('pre-schedule preserves all original values and full-week / consecutive-work checks', () => {
  assert.deepEqual(PRE_CHOICES, [
    '上班',
    '休',
    '休上',
    '例',
    '慰',
    '病',
    '事',
    '特',
  ]);
  assert.equal(assessDays(month, days).canSubmit, true);
  assert.equal(assessDays(month, Array(31).fill('上班')).abnormal, true);
  assert.equal(assessDays(month, Array(31).fill('')).incomplete, true);
  assert.equal(assessDays(month, Array(31).fill('夜O1')).valid, false);
  assert.equal(monthDays('2028-02'), 29);
  assert.throws(() => monthDays('2026-13'));
});
test('only day/night groups and formal shift takes priority over profile labels', () => {
  assert.equal(preScheduleGroup({}, 'morning'), 'day');
  for (const s of ['night', 'small-night', '小夜班', '小夜', '夜班'])
    assert.equal(preScheduleGroup({ shiftGroup: s }), 'night');
  assert.equal(preScheduleGroup({ shiftGroup: 'morning' }, 'night'), 'night');
  assert.equal(preScheduleGroup({}, undefined), null);
});
test('deadline equality is read-only and reviewers edit only after cutoff', () => {
  const m = { status: 'open', openAt: 10, closeAt: 20, publishJob: null };
  assert.equal(mayEmployeeEdit(m, 19), true);
  assert.equal(mayEmployeeEdit(m, 20), false);
  assert.equal(effectiveMonthStatus(m, 20), 'reviewing');
  assert.equal(mayReview(m, 19), false);
  assert.equal(mayReview(m, 20), true);
  assert.equal(mayReview({ ...m, publishJob: 'job' }, 21), false);
  assert.equal(mayReview({ ...m, status: 'published' }, 21), false);
});
test('monthly 750 entries produce unique formal employee+date records without changing values', () => {
  const roster = Array.from({ length: 750 }, (_, i) => ({
    employeeId: `TEST${i}`,
    name: `測試${i}`,
    title: 'PT-夜',
    group: i % 2 ? 'night' : 'day',
  }));
  const entries = roster.map((p) => ({
    employeeId: p.employeeId,
    employeeName: p.name,
    jobTitle: p.title,
    group: p.group,
    days,
    arrangedDays: days.map((code) =>
      code === '上班' ? (p.group === 'night' ? '夜O4' : '早A1') : null,
    ),
    submitted: true,
    note: '',
  }));
  const report = publicationSummary(month, roster, entries, 0, catalog);
  assert.equal(report.expected, 750);
  assert.equal(report.blocking, 0);
  const records = toFormalRecords(month, roster, entries, 'admin', catalog);
  assert.equal(records.length, 23250);
  assert.equal(new Set(records.map((r) => r.id)).size, 23250);
  assert.equal(records[0].scheduleCode, '早A1');
  assert.equal(records[31].scheduleCode, '夜O4');
  assert.equal(records[31].shiftType, 'night');
  assert.equal(
    publicationSummary(month, roster, entries.slice(1), 0, catalog).blocking,
    1,
  );
  assert.throws(() =>
    toFormalRecords(month, roster, entries.slice(1), 'admin', catalog),
  );
});

test('requests remain separate; every unresolved work cell blocks publication; off days need no area', () => {
  const person = {
    employeeId: 'P2',
    name: '測試',
    title: 'PT-夜',
    group: 'night',
  };
  const entry = {
    employeeId: 'P2',
    employeeName: '測試',
    jobTitle: 'PT-夜',
    group: 'night',
    days,
    submitted: true,
  };
  const count = days.filter((v) => v === '上班').length;
  assert.equal(
    assessArrangement(month, entry, catalog.night).unarranged,
    count,
  );
  assert.equal(
    publicationSummary(month, [person], [entry], 0, catalog).unarrangedGroups
      .night,
    count,
  );
  assert.throws(
    () => toFormalRecords(month, [person], [entry], 'admin', catalog),
    /未完成班別／區域安排/,
  );
  const arranged = {
    ...entry,
    arrangedDays: days.map((v) => (v === '上班' ? '夜O4' : null)),
  };
  assert.equal(assessArrangement(month, arranged, catalog.night).unarranged, 0);
  assert.equal(
    assessArrangement(month, arranged, catalog.night).canSubmit,
    true,
  );
  assert.equal(arranged.days[0], '上班');
  assert.equal(reviewedDays(month, arranged)[0], '夜O4');
  const result = toFormalRecords(month, [person], [arranged], 'admin', catalog);
  assert.equal(result[0].scheduleCode, '夜O4');
  assert.equal(result[4].scheduleCode, '休');
  const leaveEntry = {
    ...entry,
    days: Array(31).fill('休'),
    arrangedDays: Array(31).fill('病假'),
  };
  const leaveCatalog = { ...catalog, night: [...catalog.night, '病假'] };
  assert.equal(
    assessArrangement(month, leaveEntry, leaveCatalog.night).unarranged,
    0,
  );
  const leaveRecord = toFormalRecords(
    month,
    [person],
    [leaveEntry],
    'admin',
    leaveCatalog,
  )[0];
  assert.equal(leaveRecord.scheduleCode, '病假');
  assert.equal(leaveRecord.leaveType, '病假');
  assert.equal(
    assessArrangement(
      month,
      {
        ...arranged,
        arrangedDays: arranged.arrangedDays.map((v, i) =>
          i === 0 ? '上班／夜O4' : v,
        ),
      },
      [...catalog.night, '上班／夜O4'],
    ).unarranged,
    1,
  );
  for (const code of ['夜ZZ99', '早A1', ' 上班 ', '上班／夜O4'])
    assert.equal(
      assessArrangement(
        month,
        {
          ...arranged,
          arrangedDays: arranged.arrangedDays.map((v, i) =>
            i === 0 ? code : v,
          ),
        },
        catalog.night,
      ).valid,
      false,
    );
  assert.equal(
    assessArrangement(month, { ...arranged, arrangedDays: [] }, catalog.night)
      .incomplete,
    true,
  );
});
