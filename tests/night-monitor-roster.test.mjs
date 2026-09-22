import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {preScheduleSource} from '../functions/pre-schedule-order.mjs';
import {parseDispatchShifts} from '../lib/dispatch-shifts.ts';

// Execute the actual UI selector, not a duplicate of its selection logic.
const source=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const extract=name=>{
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start);
  return source.slice(start,end+2);
};
const js=ts.transpileModule(extract('isLeave')+'\n'+extract('deriveDutyStaff'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const select=new Function('preScheduleSource','parseDispatchShifts',js+'\nreturn deriveDutyStaff;')(preScheduleSource,parseDispatchShifts);
const rows=[
  ['95964','黃銀瑩','調度監控','夜'],
  ['96409','楊力融','實習領班-N','夜'],
  ['B0957','曾芳英','實習領班-N','生理假'],
  ['B1460','周義順','調度資專-N','夜N'],
  ['96746','柯勃甫','調度資專-N','夜監'],
];
const records=rows.map(([employeeId,employeeName,title,scheduleCode])=>({employeeId,employeeName,title,scheduleCode,date:'2026-09-22'}));
const names=result=>[...result.taipeiMonitors,...result.newTaipeiMonitors];
test('September 22 roster has exactly the three on-duty monitors',()=>{
  const before=structuredClone(records);
  assert.deepEqual(names(select(records,[],'夜')),['黃銀瑩','楊力融','柯勃甫']);
  assert.deepEqual(records,before);
});
test('monitor membership does not depend on an intern or specialist job title',()=>{
  const profiles=rows.map(([employeeId,name])=>({employeeId,name,title:'實習領班-N'}));
  assert.equal(names(select(records,profiles,'夜')).length,3);
});
test('night area assignment and leave do not enter the monitor list',()=>{
  for(const scheduleCode of ['夜N','夜S','生理假','休','例','國假','病'])
    assert.deepEqual(names(select([{...records[1],scheduleCode}],[],'夜')),[]);
});
test('plain night codes outside the roster monitor group are not monitors',()=>{
  assert.deepEqual(names(select([{...records[0],employeeId:'96504'}],[],'夜')),[]);
});
test('holiday night monitor aliases retain the existing city assignment',()=>{
  const result=select([{...records[1],scheduleCode:'國上夜'}],[],'夜');
  assert.deepEqual(result.newTaipeiMonitors,['楊力融']);
});
test('early and late views do not receive plain night monitors',()=>{
  assert.deepEqual(names(select(records,[],'早')),[]);
  assert.deepEqual(names(select(records,[],'晚')),[]);
});
test('duplicate schedule records do not duplicate the same monitor',()=>{
  assert.deepEqual(names(select([...records,records[1]],[],'夜')),['黃銀瑩','楊力融','柯勃甫']);
});
