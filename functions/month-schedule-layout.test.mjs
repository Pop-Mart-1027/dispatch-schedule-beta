import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initialMonthRows,
  changeMonthRows,
  monthSections,
} from './month-schedule-layout.mjs';
import { scheduleSections } from './pre-schedule-order.mjs';
const master = JSON.parse(
  readFileSync(new URL('../output/employee-master.json', import.meta.url)),
);
test('initial month projection keeps all 750 people and original section order', () => {
  const rows = initialMonthRows(master);
  for (const group of ['day', 'night'])
    assert.deepEqual(
      monthSections(master, group, { rows }),
      scheduleSections(master, group),
    );
  assert.equal(rows.length, 750);
});
test('B PT display hides vehicles without changing membership or source order', () => {
  const source = JSON.parse(
    readFileSync(new URL('./pre-schedule-source-order.json', import.meta.url)),
  );
  const ids = source.rows
    .filter((r) => r.section.startsWith('B機動'))
    .map((r) => r.employeeId)
    .filter((id) => master.some((p) => p.employeeId === id));
  const section = scheduleSections(master, 'day').find(
    (s) => s.label === 'B區PT',
  );
  assert.ok(ids.length > 0);
  assert.deepEqual(
    section.people.map((p) => p.employeeId),
    ids,
  );
  assert.equal(section.label.includes('9183'), false);
});
test('move and reorder preserve records; removed member can be re-added as a blank month row', () => {
  const rows = [
    {
      employeeId: 'A',
      group: 'day',
      section: 'A1區',
      areaCode: 'A1',
      blankDays: [],
    },
    {
      employeeId: 'B',
      group: 'day',
      section: 'O1區',
      areaCode: 'O1',
      blankDays: [],
    },
  ];
  const original = structuredClone(rows);
  let result = changeMonthRows(
    rows,
    {
      action: 'move',
      employeeId: 'A',
      group: 'day',
      section: 'O1區',
      areaCode: 'O1',
    },
    { employeeId: 'A' },
    '2026-09',
  );
  assert.deepEqual(
    result.rows.map((r) => r.employeeId),
    ['B', 'A'],
  );
  assert.deepEqual(rows, original);
  result = changeMonthRows(
    result.rows,
    { action: 'up', employeeId: 'A' },
    null,
    '2026-09',
  );
  assert.deepEqual(
    result.rows.map((r) => r.employeeId),
    ['A', 'B'],
  );
  assert.throws(
    () =>
      changeMonthRows(
        result.rows,
        {
          action: 'add',
          employeeId: 'A',
          group: 'day',
          section: 'O1區',
          areaCode: 'O1',
        },
        { employeeId: 'A' },
        '2026-09',
      ),
    /已存在/,
  );
  assert.throws(
    () =>
      changeMonthRows(
        result.rows,
        { action: 'remove', employeeId: 'A' },
        null,
        '2026-09',
      ),
    /確認/,
  );
  result = changeMonthRows(
    result.rows,
    { action: 'remove', employeeId: 'A', confirmed: true },
    null,
    '2026-09',
  );
  result = changeMonthRows(
    result.rows,
    {
      action: 'add',
      employeeId: 'A',
      group: 'night',
      section: 'O1區',
      areaCode: 'O1',
    },
    { employeeId: 'A' },
    '2026-09',
  );
  assert.equal(result.after.blankDays.length, 30);
  assert.equal(result.after.group, 'night');
});
