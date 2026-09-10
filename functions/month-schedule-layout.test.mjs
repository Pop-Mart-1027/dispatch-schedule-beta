import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initialMonthRows,
  changeMonthRows,
  monthSections,
  monthSectionCatalog,
  changeMonthSections,
} from './month-schedule-layout.mjs';
import { scheduleSections } from './pre-schedule-order.mjs';
const master = JSON.parse(
  readFileSync(new URL('../output/employee-master.json', import.meta.url)),
);

test('drag reorders only same-section rows without mutating people or blank days',()=>{
  const rows=['A','B','C','D'].map((employeeId,i)=>({employeeId,group:'night',section:i===3?'O2區':'O1區',areaCode:i===3?'O2':'O1',blankDays:['2']}));
  const before=structuredClone(rows);
  const result=changeMonthRows(rows,{action:'reorder',employeeId:'A',targetEmployeeId:'C',position:'after'},null,'2026-09');
  assert.deepEqual(result.rows.map(r=>r.employeeId),['B','C','A','D']);
  assert.deepEqual(result.rows.find(r=>r.employeeId==='A'),before[0]);
  assert.deepEqual(rows,before);
  assert.throws(()=>changeMonthRows(rows,{action:'reorder',employeeId:'A',targetEmployeeId:'D',position:'before'},null,'2026-09'),/同一區域/);
  assert.throws(()=>changeMonthRows(rows,{action:'reorder',employeeId:'A',targetEmployeeId:'B',position:'unknown'},null,'2026-09'),/位置/);
});

test('section rename changes label only, preserves empty sections and stable identifiers',()=>{
  const rows=initialMonthRows(master),sections=monthSectionCatalog(rows);
  const source=sections.find(s=>s.group==='night'&&s.areaCode==='O1');
  const result=changeMonthSections(sections,rows,{action:'section-rename',group:'night',sectionKey:source.key,label:'藝文車組'});
  assert.deepEqual(result.after,{...source,label:'藝文車組'});
  const original=monthSections(master,'night',{rows,sections});
  const renamed=monthSections(master,'night',{rows,sections:result.sections});
  assert.deepEqual(renamed.map(s=>[s.key,s.areaCode,s.people]),original.map(s=>[s.key,s.areaCode,s.people]));
  const custom=changeMonthSections(result.sections,rows,{action:'section-add',group:'night',label:'支援小隊'},'custom:one');
  assert.equal(custom.after.areaCode,null);
  assert.ok(monthSections(master,'night',{rows,sections:custom.sections},p=>p,true).some(s=>s.key==='custom:one'&&s.people.length===0));
  assert.deepEqual(monthSectionCatalog(rows,{sections:custom.sections}),custom.sections);
});

test('section delete requires empty section and confirmation; group/name validation is server side',()=>{
  const rows=initialMonthRows(master),sections=monthSectionCatalog(rows);
  const occupied=sections[0];
  assert.throws(()=>changeMonthSections(sections,rows,{action:'section-delete',group:occupied.group,sectionKey:occupied.key,confirmed:true}),/仍有人員/);
  const created=changeMonthSections(sections,rows,{action:'section-add',group:'night',label:'支援小隊'},'custom:x');
  assert.throws(()=>changeMonthSections(created.sections,rows,{action:'section-delete',group:'night',sectionKey:'custom:x'}),/再次確認/);
  assert.deepEqual(changeMonthSections(created.sections,rows,{action:'section-delete',group:'night',sectionKey:'custom:x',confirmed:true}).sections,sections);
  assert.throws(()=>changeMonthSections(sections,rows,{action:'section-add',group:'night',label:'O1區'},'custom:y'),/已有/);
  assert.throws(()=>changeMonthSections(sections,rows,{action:'section-add',group:'other',label:'test'},'custom:y'),/組別/);
});
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
