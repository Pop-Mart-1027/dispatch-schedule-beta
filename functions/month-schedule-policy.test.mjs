import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { moveWorkArea, monthParticipation, eligibleMonthSchedules, eligibleMonthBlocks } from './month-schedule-policy.mjs';

test('O1 moves preserve all shifts, prefixes and hours without changing other areas or leave', () => {
  const source=JSON.parse(readFileSync(new URL('../public/september-schedules.json',import.meta.url),'utf8'));
  const actualCodes=[...new Set([...source.morning,...source.night].flatMap(row=>row.shifts).filter(code=>/O1/.test(code)))];
  for(const code of actualCodes)assert.equal(moveWorkArea(code,'O1','K1'),code.replaceAll('O1','K1'));
  for (const code of ['夜O1','國上夜O1','小夜O1','國上小夜O1','早O1','晚O1','O1夜21-01','O1早07-12.5','休上夜O1'])
    assert.equal(moveWorkArea(code, 'O1', 'K1'), code.replace('O1','K1'));
  for (const code of ['休','例','病','事','慰','公','假','病假','家庭照顧','夜O4','夜O10','夜ZO1','夜監','府夜21-01','夜O4(支援O1)','病(O1)','備註O1'])
    assert.equal(moveWorkArea(code,'O1','K1'),code);
  assert.equal(moveWorkArea('國上夜O1／夜O4／O1晚18-22','O1','K1'), '國上夜K1／夜O4／K1晚18-22');
  assert.equal(moveWorkArea('夜O1','O','K'), '夜O1');
});

test('one monthly policy excludes removed staff and blank re-added days but preserves other months and raw blocks', () => {
  const layout={monthKey:'2026-09',excludedEmployeeIds:['A'],rows:[{employeeId:'B',blankDays:['1']}]};
  assert.equal(monthParticipation(layout,'A','2026-09-30'),false);
  assert.equal(monthParticipation(layout,'A','2026-08-30'),true);
  assert.equal(monthParticipation(layout,'A','2026-10-01'),true);
  assert.equal(monthParticipation(layout,'B','2026-09-01'),false);
  assert.equal(monthParticipation(layout,'B','2026-09-02'),true);
  const records=['A','B','C'].map(employeeId=>({employeeId,date:'2026-09-01'}));
  assert.deepEqual(eligibleMonthSchedules(records,layout).map(r=>r.employeeId),['C']);
  const raw=[{date:'2026-09-01',modifiedBy:'admin',drivers:[{employeeId:'A'}],stations:[{employeeId:'B'}],assistants:[{employeeId:'C'}]}];
  const original=structuredClone(raw), blocks=eligibleMonthBlocks(raw,layout);
  assert.equal(blocks[0].drivers.length,0);assert.equal(blocks[0].stations.length,0);assert.equal(blocks[0].assistants.length,1);
  assert.deepEqual(raw,original);
});

test('manual resets apply only to converted dates and older assignments of that employee',()=>{
  const layout={monthKey:'2026-09',rows:[],assignmentResetAt:{'2026-09-01':{A:{seconds:100,nanoseconds:0}}}};
  const make=(date,seconds)=>({date,modifiedAt:{seconds,nanoseconds:0},drivers:[{employeeId:'A'},{employeeId:'B'}],stations:[],assistants:[]});
  const result=eligibleMonthBlocks([make('2026-09-01',99),make('2026-09-01',101),make('2026-09-02',99),make('2026-08-01',99)],layout);
  assert.deepEqual(result.map(b=>b.drivers.map(p=>p.employeeId)),[['B'],['A','B'],['A','B'],['A','B']]);
  assert.deepEqual(result.map(b=>b.monthAssignmentResetIds),[['A'],[],[],[]]);
});
