import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scheduleSections, preScheduleSource } from './pre-schedule-order.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';
import {
  getAreaJumpOptions,
  getScheduleAreaDisplayLabel,
} from './schedule-display.mjs';
const master = JSON.parse(
  await readFile(
    new URL('../output/employee-master.json', import.meta.url),
    'utf8',
  ),
);
const source = JSON.parse(
  await readFile(
    new URL('../public/september-schedules.json', import.meta.url),
    'utf8',
  ),
);

test('only directors are supervisors; regional foremen retain their source section and original sourceOrder', () => {
  const sections = scheduleSections(master, 'day');
  assert.deepEqual(
    sections
      .find((s) => s.label === '單位主官')
      .people.map((p) => [p.employeeId, p.title]),
    [
      ['93900', '調度主任'],
      ['93339', '調度副主任'],
      ['95011', '調度副主任'],
    ],
  );
  for (const id of [
    '97305',
    '95422',
    '94268',
    '95660',
    '94245',
    '95896',
    'B0036',
    '95195',
    '93950',
  ]) {
    const raw = source.morning.find((r) => r.employeeId === id),
      metadata = preScheduleSource(id);
    assert.equal(metadata.section, raw.group);
    assert.equal(metadata.sourceOrder, source.morning.indexOf(raw));
    assert.ok(
      sections
        .find((s) => s.key === scheduleSectionIdentity(raw.group).key)
        .people.some((p) => p.employeeId === id),
    );
    assert.equal(metadata.category, 'area');
  }
  for (const p of master) {
    const meta = preScheduleSource(p.employeeId),
      rows = source[meta.group === 'day' ? 'morning' : 'night'];
    assert.equal(
      rows[meta.sourceOrder].rowId.split('-').at(-1),
      String(meta.sourceRow),
    );
    assert.equal(rows[meta.sourceOrder].employeeId, p.employeeId);
  }
});

test('display label aliases never change area identity, source order, people, or schedule cells', () => {
  for (const [raw, label] of Object.entries({
    F1: 'F區',
    I2: 'I區',
    ZH2: 'ZH區',
    M2: 'M區',
    W3: 'W1區',
    W2: 'W2區',
  })) {
    const id = scheduleSectionIdentity(`${raw}區`, '', 'night');
    assert.equal(id.key, `area:${raw}`);
    assert.equal(id.areaCode, raw);
    assert.equal(id.label, label);
  }
  const expected = {
    F1: ['96165', '96697', 'B4696'],
    I2: ['95181', 'B1065', 'B2858', 'B5326', 'B5636'],
    ZH2: [
      '95205',
      'B1944',
      'B2207',
      'B3733',
      'B5336',
      'B0048',
      'B0831',
      'B1598',
      'B4419',
    ],
    M2: ['97435', '97436', 'B5379'],
    W3: ['B0832', 'B1811', 'B6013', 'B2146', 'B2386', 'B3581'],
    W2: ['95848', 'B0429', 'B4509'],
  };
  const rows = master.map((p) => ({
    ...p,
    days: source.night.find((r) => r.employeeId === p.employeeId)?.shifts || [],
  }));
  const before = structuredClone(rows);
  const sections = scheduleSections(rows, 'night');
  for (const [area, ids] of Object.entries(expected)) {
    const section = sections.find((s) => s.areaCode === area);
    assert.deepEqual(
      section.people.map((p) => p.employeeId),
      ids,
    );
    assert.ok(section.people.every((p) => rows.includes(p)));
  }
  assert.deepEqual(rows, before);
  // A duplicate display label is never a grouping key.
  assert.notEqual(
    scheduleSectionIdentity('W1區').key,
    scheduleSectionIdentity('W3區').key,
  );
});

test('numeric display aliases require the night source; day and unknown sources retain original titles', () => {
  const aliases = { F1: 'F', I2: 'I', ZH2: 'ZH', M2: 'M', W3: 'W1' };
  for (const [code, label] of Object.entries(aliases)) {
    for (const group of ['day', 'morning', '9月日班', '']) {
      assert.equal(
        getScheduleAreaDisplayLabel(`${code}區`, group),
        `${code}區`,
      );
    }
    for (const group of ['night', 'small-night', '9月夜班', '大小夜班']) {
      assert.equal(
        getScheduleAreaDisplayLabel(`${code}區`, group),
        `${label}區`,
      );
    }
    assert.equal(
      scheduleSectionIdentity(`${code}區`, '', 'day').key,
      scheduleSectionIdentity(`${code}區`, '', 'night').key,
    );
  }
  const day = scheduleSections(master, 'day'),
    night = scheduleSections(master, 'night');
  assert.deepEqual(
    day.filter((s) => /^W\d+$/.test(s.areaCode || '')).map((s) => s.label),
    ['W1區', 'W2區', 'W3區'],
  );
  assert.deepEqual(
    night.filter((s) => /^W\d+$/.test(s.areaCode || '')).map((s) => s.label),
    ['W1區', 'W2區'],
  );
  assert.deepEqual(
    day.filter((s) => /^I\d+$/.test(s.areaCode || '')).map((s) => s.label),
    ['I1區', 'I2區', 'I3區'],
  );
  assert.equal(night.find((s) => s.areaCode === 'I2').label, 'I區');
});

test('engineering team hides vehicle everywhere in its display identity and preserves both people', () => {
  const identity = scheduleSectionIdentity('工兵小隊-BBK-0278');
  assert.deepEqual(identity, {
    key: 'section:工兵小隊',
    areaCode: null,
    label: '工兵小隊',
  });
  assert.equal(getScheduleAreaDisplayLabel('工兵小隊 - BBK-0278'), '工兵小隊');
  assert.deepEqual(
    scheduleSections(master, 'day')
      .find((s) => s.key === identity.key)
      .people.map((p) => p.employeeId),
    ['93947', 'B5456'],
  );
});

test('Fuqian PT combines display sections without duplicating staff or moving cross-source night members', () => {
  const day = scheduleSections(master, 'day'),
    night = scheduleSections(master, 'night');
  const pt = day.find((s) => s.label === '府前PT');
  assert.equal(pt.people.length, 20);
  assert.equal(pt.areaCode, null);
  assert.equal(
    day.filter((s) => ['J2區', '晚PT數字'].includes(s.label)).length,
    0,
  );
  const ids = pt.people.map((p) => p.employeeId);
  assert.deepEqual(ids.slice(-6), [
    'B3276',
    'B3428',
    'B3884',
    'B3885',
    'B3917',
    'B5828',
  ]);
  assert.equal(new Set(ids).size, 20);
  const all = [...day, ...night].flatMap((s) => s.people);
  for (const row of source.morning.filter((r) => r.group === '晚PT數字'))
    assert.equal(all.filter((p) => p.employeeId === row.employeeId).length, 1);
  assert.equal(preScheduleSource('B3810').group, 'night');
  assert.equal(preScheduleSource('B3810').section, 'A1區');
});

test('navigation families retain the first rendered target and never filter or reorder source sections', () => {
  const sections = [
    { key: 'o4-first', areaCode: 'O4', label: 'O4區' },
    { key: 'o1', areaCode: 'O1', label: 'O1區' },
    { key: 'w3', areaCode: 'W3', label: 'W1區' },
    { key: 'w2', areaCode: 'W2', label: 'W2區' },
    { key: 'zh2', areaCode: 'ZH2', label: 'ZH區' },
    { key: 'boss', areaCode: null, label: '單位主官' },
  ];
  const before = structuredClone(sections),
    options = getAreaJumpOptions(sections);
  assert.deepEqual(
    options.map((x) => x.label),
    ['單位主官', 'O', 'W', 'ZH'],
  );
  assert.equal(options.find((x) => x.label === 'O').key, 'o4-first');
  assert.equal(options.find((x) => x.label === 'W').key, 'w3');
  assert.deepEqual(sections, before);
});
