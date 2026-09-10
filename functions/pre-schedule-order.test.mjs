import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  preScheduleRoster,
  preScheduleSource,
  preScheduleEntry,
} from './pre-schedule-order.mjs';
import sourceOrder from './pre-schedule-source-order.json' with { type: 'json' };
const master = JSON.parse(
  await readFile(
    new URL('../output/employee-master.json', import.meta.url),
    'utf8',
  ),
);

test('September fixed source order covers the 750-person official master; excludes rejected source IDs', async () => {
  const bytes = await readFile(
    new URL('../public/september-schedules.json', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    sourceOrder.sourceSha256,
  );
  const people = preScheduleRoster(master);
  assert.equal(people.length, 750);
  assert.equal(people.filter((p) => p.group === 'day').length, 597);
  assert.equal(people.filter((p) => p.group === 'night').length, 153);
  assert.ok(people.every((p) => preScheduleSource(p.employeeId)));
  assert.ok(!people.some((p) => p.employeeId === 'B6033'));
  assert.equal(new Set(people.map((p) => p.employeeId)).size, 750);
});

test('leaders and monitors stay day regardless of daily codes; night O1 retains source order including small-night/PT', () => {
  const people = preScheduleRoster(
    master
      .map((p) => ({
        ...p,
        group: 'day',
        shiftType: 'night',
        scheduleCode: '夜O4',
      }))
      .reverse(),
  );
  const day = people.filter((p) => p.group === 'day'),
    night = people.filter((p) => p.group === 'night');
  assert.deepEqual(
    day.slice(0, 3).map((p) => p.employeeId),
    ['93900', '93339', '95011'],
  );
  assert.ok(
    people
      .filter((p) => preScheduleSource(p.employeeId).category !== 'area')
      .every((p) => p.group === 'day'),
  );
  assert.equal(night.findIndex((p) => p.employeeId === '96504') + 1, 122);
  assert.deepEqual(
    night
      .filter((p) => preScheduleSource(p.employeeId).section === 'O1區')
      .map((p) => p.employeeId),
    ['96504', 'B3175', 'B5784', 'B0410', 'B5167'],
  );
  // Filtering cannot sort the O1 employee IDs anew.
  assert.deepEqual(
    night
      .filter((p) => ['B5167', '96504', 'B5784'].includes(p.employeeId))
      .map((p) => p.employeeId),
    ['96504', 'B5784', 'B5167'],
  );
});

test('legacy group projection never mutates submitted days or stored entry', () => {
  const entry = {
    employeeId: '96504',
    group: 'day',
    days: ['上班', '休'],
    arrangedDays: ['夜O4', null],
    submitted: true,
    revision: 8,
  };
  const before = structuredClone(entry),
    result = preScheduleEntry(entry);
  assert.equal(result.group, 'night');
  assert.deepEqual(entry, before);
  assert.deepEqual(result.days, before.days);
  assert.deepEqual(result.arrangedDays, before.arrangedDays);
  assert.equal(result.revision, 8);
});
