import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScheduleSheet,discoverSheets,planScheduleSync} from './schedule-sheet-domain.mjs';
const sheet={title:'9月日班',month:'2026-09',group:'day'};
const csv=(codes=Array(30).fill('早S'))=>[
  ['',2026,9],['','','','',...Array.from({length:30},(_,i)=>`9月${i+1}日`)],
  ['區域','職務名稱','員工編號','姓名'],['','S區-ABC-1234','','',...Array(30).fill('')],
  ['','調度專員','B9999','測試人員',...codes],
].map(r=>r.join(',')).join('\n');
const person={employeeId:'B9999',name:'測試人員',active:true};
const row={employeeId:'B9999',group:'day',section:'S區',areaCode:'S',blankDays:[]};
const layout={id:'2026-09',monthKey:'2026-09',revision:5,rows:[row],sections:[{key:'area:S',group:'day',section:'S區',areaCode:'S',label:'S區'}]};
const source=()=>parseScheduleSheet(csv(),sheet);
const plan=(extra={})=>planScheduleSync({source:source(),employees:[person],records:[],layouts:[layout],...extra});
test('parses September 1 through 30 using actual header positions',()=>{const p=source();assert.equal(p.length,1);assert.equal(p[0].codes.length,30);assert.equal(p[0].areaCode,'S')});
test('rejects HTML and missing date columns',()=>{assert.throws(()=>parseScheduleSheet('<html>login</html>',sheet));assert.throws(()=>parseScheduleSheet(csv().replace('9月30日',''),sheet))});
test('ignores archived previous-year sheets',()=>assert.equal(parseScheduleSheet(csv().replace('2026','2025'),sheet),null));
test('rejects invalid formula results',()=>assert.throws(()=>parseScheduleSheet(csv(Array(30).fill('#REF!')),sheet)));
test('writes only September or later',()=>assert.ok(plan().updates.every(u=>u.after.date>='2026-09-01')));
test('existing records update only code fields',()=>{const before={id:'custom',employeeId:person.employeeId,date:'2026-09-01',scheduleCode:'休',note:'keep',vehicle:'keep'};const u=plan({records:[before]}).updates.find(u=>u.id==='custom');assert.deepEqual(Object.keys(u.after).sort(),['leaveType','scheduleCode','scheduleLabel']);assert.equal(u.before.note,'keep')});
test('unchanged cells are not written again',()=>{const records=plan().updates.map(u=>({id:u.id,...u.after}));assert.equal(plan({records}).updates.length,0)});
test('explicit empty cell clears the code, not the person',()=>{const s=source();s[0].codes[0]='';const p=plan({source:s,records:[{id:'one',employeeId:person.employeeId,date:'2026-09-01',scheduleCode:'早S'}]});assert.equal(p.updates.find(u=>u.id==='one').after.scheduleCode,'');assert.equal(p.cleared,1)});
test('same employee morning and evening rows retain both codes',()=>{const s=source();assert.equal(plan({source:[s[0],{...s[0],codes:Array(30).fill('晚S')}]}).updates[0].after.scheduleCode,'早S／晚S')});
test('identical duplicate cells deduplicate',()=>{const s=source();assert.equal(plan({source:[s[0],s[0]]}).updates[0].after.scheduleCode,'早S')});
test('existing day membership rejects other night-tab values',()=>{const s=source();assert.equal(plan({source:[...s,{...s[0],group:'night',codes:Array(30).fill('夜S')}]}).updates[0].after.scheduleCode,'早S')});
test('unknown employee is not provisioned',()=>{const p=plan({employees:[]});assert.equal(p.updates.length,0);assert.equal(p.issues[0].reason,'missing-or-inactive-employee')});
test('new employee appended after existing area members without sorting others',()=>{const old={...row,employeeId:'B8888'};const l={...layout,rows:[old,{...old,employeeId:'B7777',areaCode:'T',section:'T區'}]};const p=plan({layouts:[l]});assert.deepEqual(p.layoutChanges[0].after.rows.map(r=>r.employeeId),['B8888','B9999','B7777']);assert.deepEqual(p.layoutChanges[0].after.sections,l.sections)});
test('unmapped area and explicitly removed employees remain unchanged',()=>{assert.equal(plan({layouts:[{...layout,rows:[],sections:[]}]}).updates.length,0);assert.equal(plan({layouts:[{...layout,excludedEmployeeIds:['B9999']}]}).updates.length,0)});
test('duplicate app employee-date is not overwritten',()=>{const r={employeeId:person.employeeId,date:'2026-09-01'};const p=plan({records:[{...r,id:'a'},{...r,id:'b'}]});assert.ok(!p.updates.some(u=>['a','b'].includes(u.id)));assert.ok(p.issues.some(i=>i.reason==='duplicate-app-records'))});
test('discovers only roster tabs after September',()=>{const html=['8月日班','9月日班','9月夜班','9月監控值機'].map((name,i)=>`items.push({name: "${name}", pageUrl: "url", gid: "${i}"`).join(';');assert.equal(discoverSheets(html).length,2)});
