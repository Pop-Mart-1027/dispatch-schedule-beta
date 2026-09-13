import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRoster, monthlySections, monthlyEntry, placeMonthlyPerson } from '../functions/pre-schedule-roster.mjs';
import { preScheduleRoster, scheduleSections } from '../functions/pre-schedule-order.mjs';
const original = [
  { employeeId: '96504', name: 'fixture', title: 'fixture', group: 'day' },
  { employeeId: '93900', name: 'fixture', title: 'fixture', group: 'night' },
  { employeeId: 'B0410', name: 'fixture', title: 'fixture', group: 'day' },
];
test('legacy month retains original source groups, sections and order', () => {
  assert.deepEqual(monthlyRoster(original), preScheduleRoster(original));
  for (const group of ['day', 'night']) assert.deepEqual(monthlySections(original, group), scheduleSections(original, group));
});
test('month-only override can move source employee to another group without changing source', () => {
  const old = monthlyRoster(original);
  const changed = { ...old.find(p => p.employeeId === '96504'), group: 'day', rosterGroup: 'day', rosterSection: 'O1區' };
  const moved = placeMonthlyPerson(old, changed);
  assert.equal(monthlyRoster(moved).find(p => p.employeeId === '96504').group, 'day');
  assert.ok(monthlySections(moved, 'day').some(s => s.people.some(p => p.employeeId === '96504')));
  assert.ok(!monthlySections(moved, 'night').some(s => s.people.some(p => p.employeeId === '96504')));
  assert.equal(monthlyRoster(original).find(p => p.employeeId === '96504').group, 'night');
});
test('position before a person persists and each ID occurs only once', () => {
  const a={employeeId:'N1',name:'one',group:'night',rosterGroup:'night',rosterSection:'O1區'};
  const b={...a,employeeId:'N2',name:'two'};
  const first=placeMonthlyPerson([],a);
  const second=placeMonthlyPerson(first,b,'N1');
  const last=placeMonthlyPerson(second,a,'N2');
  assert.deepEqual(monthlySections(last,'night')[0].people.map(p=>p.employeeId),['N1','N2']);
  assert.equal(new Set(last.map(p=>p.employeeId)).size,2);
  assert.deepEqual(last.map(p=>p.rosterOrder),[0,1]);
});
test('rejects missing or cross-section position target', () => {
  const people=[{employeeId:'N1',group:'day',rosterSection:'A1區'}];
  assert.throws(()=>placeMonthlyPerson(people,{employeeId:'N2',group:'day',rosterSection:'O1區'},'N1'));
  assert.throws(()=>placeMonthlyPerson(people,{employeeId:'N2',group:'day',rosterSection:'A1區'},'missing'));
});
test('entry group follows monthly override without modifying saved cells or notes', () => {
  const entry={employeeId:'96504',group:'night',days:['休'],arrangedDays:['早A1'],note:'preserve',revision:7};
  const value=monthlyEntry(entry,[{employeeId:'96504',group:'day'}]);
  assert.equal(value.group,'day');
  assert.deepEqual(value.days,['休']); assert.deepEqual(value.arrangedDays,['早A1']);
  assert.equal(value.note,'preserve'); assert.equal(value.revision,7); assert.equal(entry.group,'night');
});
