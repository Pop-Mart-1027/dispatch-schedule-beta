import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  preScheduleRoster,
  preScheduleSource,
  preScheduleEntry,
  scheduleSections,
} from './pre-schedule-order.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';
import sourceOrder from './pre-schedule-source-order.json' with { type: 'json' };
const master = JSON.parse(
  await readFile(
    new URL('../output/employee-master.json', import.meta.url),
    'utf8',
  ),
);

test('display section codes normalize source typography without merging fine areas or variants', () => {
  assert.equal(
    scheduleSectionIdentity('〇1區').key,
    scheduleSectionIdentity('O1區').key,
  );
  assert.equal(scheduleSectionIdentity('Ｏ１區').key, 'area:O1');
  assert.equal(scheduleSectionIdentity('U區BFR-5181').key, 'area:U');
  assert.equal(
    new Set(
      ['O1', 'O2', 'O4', 'ZO1', 'I1', 'I2', 'I3'].map(
        (code) => scheduleSectionIdentity(`${code}區`).key,
      ),
    ).size,
    7,
  );
  assert.equal(scheduleSectionIdentity('工兵小隊-BBK-0278').areaCode, null);
});

test('all matrices share contiguous unique sections and original in-section order without mutating rows', () => {
  const input = master.slice().reverse(),
    before = structuredClone(input);
  for (const [group, count] of [
    ['day', 592],
    ['night', 158],
  ]) {
    const sections = scheduleSections(input, group),
      people = sections.flatMap((section) => section.people);
    assert.equal(people.length, count);
    const areas = sections
      .filter((section) => section.areaCode)
      .map((section) => section.areaCode);
    assert.equal(new Set(areas).size, areas.length);
    for (const section of sections) {
      const order = section.people.map(
        (person) => preScheduleSource(person.employeeId).scheduleDisplayOrder,
      );
      assert.deepEqual(
        order,
        order.slice().sort((a, b) => a - b),
      );
    }
    assert.deepEqual(
      scheduleSections(
        input.map((person) => ({ person })),
        group,
        (row) => row.person,
      ).flatMap((section) =>
        section.people.map((row) => row.person.employeeId),
      ),
      people.map((person) => person.employeeId),
    );
    assert.equal(
      sections.filter((section) => section.areaCode === 'O1').length,
      1,
    );
    if (group === 'night')
      assert.deepEqual(
        sections
          .find((section) => section.areaCode === 'O1')
          .people.map((person) => person.employeeId),
        ['96504', 'B3175', 'B5784', 'B0410', 'B5167'],
      );
    else
      assert.deepEqual(
        people.slice(0, 3).map((person) => person.employeeId),
        ['93900', '93339', '95011'],
      );
  }
  assert.deepEqual(input, before);
});

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
  assert.equal(people.filter((p) => p.group === 'day').length, 592);
  assert.equal(people.filter((p) => p.group === 'night').length, 158);
  assert.ok(people.every((p) => preScheduleSource(p.employeeId)));
  assert.ok(!people.some((p) => p.employeeId === 'B6033'));
  assert.equal(new Set(people.map((p) => p.employeeId)).size, 750);
});

test('source sheet fixes membership regardless of title/daily codes; night O1 retains original team order', () => {
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
      .filter((p) => preScheduleSource(p.employeeId).sourceSheet === '9月日班')
      .every((p) => p.group === 'day'),
  );
  assert.equal(night.findIndex((p) => p.employeeId === '96504') + 1, 127);
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

test('all five night duty staff use their night source regardless of misleading job titles', () => {
  const ids=['95964','96409','B0957','B1460','96746'];
  for(const id of ids) {
    const person=preScheduleRoster([{employeeId:id,title:'調度主任',group:'day',scheduleCode:'早A1'}])[0];
    assert.equal(person.group,'night');
    assert.equal(preScheduleSource(id).sourceSheet,'9月夜班');
    assert.equal(preScheduleEntry({employeeId:id,group:'day',days:['夜監']}).group,'night');
  }
});
