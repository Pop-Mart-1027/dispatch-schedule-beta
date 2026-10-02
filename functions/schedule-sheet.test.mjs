import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScheduleSheet,discoverSheets,planScheduleSync,planNewScheduleEmployees} from './schedule-sheet-domain.mjs';
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
void test('parses September 1 through 30 using actual header positions',()=>{const p=source();assert.equal(p.length,1);assert.equal(p[0].codes.length,30);assert.equal(p[0].areaCode,'S')});
void test('rejects HTML and missing date columns',()=>{assert.throws(()=>parseScheduleSheet('<html>login</html>',sheet));assert.throws(()=>parseScheduleSheet(csv().replace('9月30日',''),sheet))});
void test('ignores archived previous-year sheets',()=>assert.equal(parseScheduleSheet(csv().replace('2026','2025'),sheet),null));
void test('rejects invalid formula results',()=>assert.throws(()=>parseScheduleSheet(csv(Array(30).fill('#REF!')),sheet)));
void test('writes only September or later',()=>assert.ok(plan().updates.every(u=>u.after.date>='2026-09-01')));
void test('existing records update only code fields',()=>{const before={id:'custom',employeeId:person.employeeId,date:'2026-09-01',scheduleCode:'休',note:'keep',vehicle:'keep'};const u=plan({records:[before]}).updates.find(u=>u.id==='custom');assert.deepEqual(Object.keys(u.after).sort(),['leaveType','scheduleCode','scheduleLabel']);assert.equal(u.before.note,'keep')});
void test('unchanged cells are not written again',()=>{const records=plan().updates.map(u=>({id:u.id,...u.after}));assert.equal(plan({records}).updates.length,0)});
void test('explicit empty cell clears the code, not the person',()=>{const s=source();s[0].codes[0]='';const p=plan({source:s,records:[{id:'one',employeeId:person.employeeId,date:'2026-09-01',scheduleCode:'早S'}]});assert.equal(p.updates.find(u=>u.id==='one').after.scheduleCode,'');assert.equal(p.cleared,1)});
void test('same employee morning and evening rows retain both codes',()=>{const s=source();assert.equal(plan({source:[s[0],{...s[0],codes:Array(30).fill('晚S')}]}).updates[0].after.scheduleCode,'早S／晚S')});
void test('identical duplicate cells deduplicate',()=>{const s=source();assert.equal(plan({source:[s[0],s[0]]}).updates[0].after.scheduleCode,'早S')});
void test('existing day membership rejects other night-tab values',()=>{const s=source();assert.equal(plan({source:[...s,{...s[0],group:'night',codes:Array(30).fill('夜S')}]}).updates[0].after.scheduleCode,'早S')});
void test('unknown employee is not provisioned',()=>{const p=plan({employees:[]});assert.equal(p.updates.length,0);assert.equal(p.issues[0].reason,'missing-or-inactive-employee')});
void test('new employee appended after existing area members without sorting others',()=>{const old={...row,employeeId:'B8888'};const l={...layout,rows:[old,{...old,employeeId:'B7777',areaCode:'T',section:'T區'}]};const p=plan({layouts:[l]});assert.deepEqual(p.layoutChanges[0].after.rows.map(r=>r.employeeId),['B8888','B9999','B7777']);assert.deepEqual(p.layoutChanges[0].after.sections,l.sections)});
void test('unmapped area and explicitly removed employees remain unchanged',()=>{assert.equal(plan({layouts:[{...layout,rows:[],sections:[]}]}).updates.length,0);assert.equal(plan({layouts:[{...layout,excludedEmployeeIds:['B9999']}]}).updates.length,0)});
void test('duplicate app employee-date is not overwritten',()=>{const r={employeeId:person.employeeId,date:'2026-09-01'};const p=plan({records:[{...r,id:'a'},{...r,id:'b'}]});assert.ok(!p.updates.some(u=>['a','b'].includes(u.id)));assert.ok(p.issues.some(i=>i.reason==='duplicate-app-records'))});
void test('discovers only roster tabs after September',()=>{const html=['8月日班','9月日班','9月夜班','9月監控值機'].map((name,i)=>`items.push({name: "${name}", pageUrl: "url", gid: "${i}"`).join(';');assert.equal(discoverSheets(html).length,2)});

for(const [month,days] of [['10',31],['11',30],['12',31]]) {
  void test(`new ${month}月 roster creates its layout and all ${days} days without existing records`,()=>{
    const input=csv(Array(days).fill('早S')).replace(',2026,9',`,2026,${month}`).replace(/9月/g,`${month}月`);
    // The fixture's date row also needs the extra day for 31-day months.
    const complete=input.replace(`${month}月30日\n`,`${month}月30日${days===31?`,${month}月31日`:''}\n`);
    const source=parseScheduleSheet(complete,{title:`${month}月日班`,month:`2026-${month}`,group:'day'});
    const p=plan({source,layouts:[]});
    assert.equal(p.issues.length,0);
    assert.equal(p.updates.length,days);
    assert.equal(p.updates.at(-1).after.date,`2026-${month}-${days}`);
    assert.deepEqual(p.layoutChanges[0].after.rows.map(r=>r.employeeId),[person.employeeId]);
    assert.equal(p.layoutChanges[0].after.sections[0].key,'area:S');
    const records=p.updates.map(u=>({id:u.id,...u.after}));
    assert.equal(plan({source,records,layouts:[p.layoutChanges[0].after]}).updates.length,0);
    assert.equal(plan({source,records,layouts:[p.layoutChanges[0].after]}).layoutChanges.length,0);
  });
}
void test('repairs an empty month layout previously created by sync',()=>{
  const broken={monthKey:'2026-09',revision:1,rows:[],excludedEmployeeIds:[],modifiedBy:'google-schedule-sync'};
  const p=plan({layouts:[broken]});
  assert.equal(p.issues.length,0);
  assert.equal(p.updates.length,30);
  assert.equal(p.layoutChanges[0].after.sections[0].key,'area:S');
});
void test('an empty administrator layout is not repopulated from the source',()=>{
  const p=plan({layouts:[{...layout,rows:[],sections:[],modifiedBy:'admin'}]});
  assert.equal(p.updates.length,0);
  assert.equal(p.layoutChanges.length,0);
  assert.equal(p.issues[0].reason,'unmapped-source-area');
});
void test('source special sections initialize a new month without carrying the previous area',()=>{
  const special=csv().replace('S區-ABC-1234','B機動-ABC-1234');
  const parsed=parseScheduleSheet(special,sheet);
  assert.equal(parsed[0].areaCode,null);
  assert.equal(parsed[0].section,'B機動');
  const p=plan({source:parsed,layouts:[]});
  assert.equal(p.issues.length,0);
  assert.equal(p.layoutChanges[0].after.rows[0].sectionKey,'section:B區PT');
  assert.equal(p.layoutChanges[0].after.sections[0].label,'B區PT');
});
void test('recognizes area headings without a separator after 區',()=>{
  const parsed=parseScheduleSheet(csv().replace('S區-ABC-1234','U區RGE-1661'),sheet);
  assert.equal(parsed[0].areaCode,'U');
});
void test('unmapped source does not persist an empty month layout',()=>{
  const s=source().map(r=>({...r,areaCode:null,section:''}));
  const p=plan({source:s,layouts:[]});
  assert.equal(p.updates.length,0);
  assert.equal(p.layoutChanges.length,0);
  assert.equal(p.issues[0].reason,'unmapped-source-area');
});
void test('later months can be discovered after September tabs have been archived',()=>{
  const html=['10月日班','10月夜班','11月日班','12月夜班'].map((name,i)=>`items.push({name: "${name}", pageUrl: "url", gid: "${i}"`).join(';');
  assert.deepEqual(discoverSheets(html).map(s=>s.month),['2026-10','2026-10','2026-11','2026-12']);
  assert.throws(()=>discoverSheets('items.push({name: "行事曆", pageUrl: "url", gid: "0"'),/找不到/);
});
void test('new month placement follows its night records and source instead of the old day roster',()=>{
  const employeeId='93900';
  const sourceRows=source().map(r=>({...r,employeeId,month:'2026-10',group:'night',areaCode:'O4',section:'O4區',codes:Array(31).fill('夜O4')}));
  const p=plan({source:sourceRows,employees:[{...person,employeeId}],layouts:[],records:[{id:'existing',employeeId,date:'2026-10-01',shiftType:'night',scheduleCode:'休'}]});
  assert.equal(p.issues.length,0);
  assert.equal(p.layoutChanges[0].after.rows[0].group,'night');
  assert.equal(p.layoutChanges[0].after.rows[0].areaCode,'O4');
  assert.equal(p.updates.find(u=>u.after.date==='2026-10-02').after.shiftType,'night');
});

const detectedAt='2026-10-02T03:00:00.000Z';
const newEmployeeSource=(extra={})=>({...source()[0],month:'2026-10',areaCode:'G',section:'G區',codes:Array(31).fill('早G'),...extra});
const provision=(extra={})=>planNewScheduleEmployees({source:[newEmployeeSource()],employees:[],now:detectedAt,...extra});

void test('a source newcomer is planned in its source area with a three-calendar-month highlight',()=>{
  const p=provision();
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(p.employees,[{
    employeeId:'B9999',name:'測試人員',title:'調度專員',group:'day',section:'G區',areaCode:'G',
    role:'employee',active:true,mustChangePassword:true,hireDate:'2026-10-02',
    onboardingStartedAt:detectedAt,onboardingHighlightUntil:'2027-01-02T03:00:00.000Z',
    hireDateSource:'schedule-first-seen',scheduleSourceMonth:'2026-10',source:'google-schedule-sync',
  }]);
});

void test('existing profiles are never edited, reactivated, or given another highlight period',()=>{
  const existing=[{...person,role:'admin',onboardingStartedAt:'2026-01-01T00:00:00.000Z'},{id:'B8888',active:false}];
  const before=structuredClone(existing);
  const p=provision({employees:existing,source:[newEmployeeSource(),newEmployeeSource({employeeId:'B8888'})]});
  assert.deepEqual(p.employees,[]);
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(existing,before);
  assert.deepEqual(provision({employees:provision().employees,now:'2026-10-03T03:00:00.000Z'}).employees,[]);
});

void test('only ended source months cannot create employees',()=>{
  const p=provision({source:[newEmployeeSource({month:'2026-09'})]});
  assert.equal(p.employees.length,0);
  assert.equal(p.issues[0].reason,'not-in-current-source-month');
  assert.equal(p.issues[0].currentMonth,'2026-10');
});

void test('each newcomer uses its latest available month even when another sheet is newer',()=>{
  const p=provision({source:[newEmployeeSource(),newEmployeeSource({employeeId:'B8888',month:'2026-11',name:'十一月新人'})]});
  assert.equal(p.employees.length,2);
  assert.equal(p.employees.find(e=>e.employeeId==='B9999').scheduleSourceMonth,'2026-10');
});

void test('past source group and area changes do not conflict with the latest placement',()=>{
  const p=provision({source:[newEmployeeSource({month:'2026-09',group:'night',section:'S區',areaCode:'S'}),newEmployeeSource()]});
  assert.equal(p.issues.length,0);
  assert.equal(p.employees[0].group,'day');
  assert.equal(p.employees[0].areaCode,'G');
});

void test('conflicting source names never create an employee even across months',()=>{
  const p=provision({source:[newEmployeeSource({month:'2026-09',name:'另一位人員'}),newEmployeeSource()]});
  assert.equal(p.employees.length,0);
  assert.equal(p.issues[0].reason,'conflicting-source-names');
});

void test('ambiguous current-month source groups or areas require review',()=>{
  for(const [extra,reason] of [[{group:'night'},'ambiguous-source-group'],[{areaCode:'H',section:'H區'},'ambiguous-source-area']]) {
    const p=provision({source:[newEmployeeSource(),newEmployeeSource(extra)]});
    assert.equal(p.employees.length,0);
    assert.equal(p.issues[0].reason,reason);
  }
});

void test('identical source duplicates create only one proposed profile',()=>{
  const p=provision({source:[newEmployeeSource(),newEmployeeSource()]});
  assert.equal(p.employees.length,1);
  assert.equal(p.issues.length,0);
});

void test('missing or contradictory source areas cannot create employees',()=>{
  for(const extra of [{areaCode:null,section:''},{areaCode:'H',section:'G區'},{areaCode:'?'}]) {
    const p=provision({source:[newEmployeeSource(extra)]});
    assert.equal(p.employees.length,0);
    assert.equal(p.issues[0].reason,'unmapped-source-area');
  }
});

void test('source special sections preserve their source identity for newcomers',()=>{
  const p=provision({source:[newEmployeeSource({section:'B機動',areaCode:null})]});
  assert.equal(p.issues.length,0);
  assert.equal(p.employees[0].section,'B機動');
  assert.equal(p.employees[0].areaCode,null);
});

void test('source titles cannot grant elevated roles and blank titles get a usable default',()=>{
  const p=provision({source:[newEmployeeSource({title:'調度監控主管',role:'admin'})]});
  assert.equal(p.employees[0].role,'employee');
  assert.equal(p.employees[0].title,'調度監控主管');
  assert.equal(provision({source:[newEmployeeSource({title:'  '})]}).employees[0].title,'調度專員');
  assert.equal(provision({source:[newEmployeeSource({title:'長'.repeat(101)})]}).issues[0].reason,'invalid-source-title');
});

void test('three-calendar-month expiry clamps month ends and preserves Taiwan wall-clock time',()=>{
  for(const [now,month,hireDate,until] of [
    ['2026-01-31T10:20:30.123Z','2026-01','2026-01-31','2026-04-30T10:20:30.123Z'],
    ['2026-11-30T08:00:00.000Z','2026-11','2026-11-30','2027-02-28T08:00:00.000Z'],
    ['2027-11-30T08:00:00.000Z','2027-11','2027-11-30','2028-02-29T08:00:00.000Z'],
    ['2026-09-30T17:00:00.000Z','2026-10','2026-10-01','2026-12-31T17:00:00.000Z'],
  ]) {
    const p=provision({now:new Date(now),source:[newEmployeeSource({month})]});
    assert.equal(p.employees[0].hireDate,hireDate);
    assert.equal(p.employees[0].onboardingHighlightUntil,until);
  }
  assert.throws(()=>provision({now:'invalid'}),/首次偵測時間/);
});

void test('new source employees extend the catalog and append after their area without moving existing staff',()=>{
  const employee=provision().employees[0];
  const custom={key:'area:S',group:'day',section:'S區',areaCode:'S',label:'自訂S名稱'};
  const l={...layout,id:'2026-10',monthKey:'2026-10',rows:[{...row,employeeId:'B8888'}],sections:[custom],modifiedBy:'admin'};
  const p=plan({source:[newEmployeeSource()],employees:[employee],layouts:[l]});
  assert.equal(p.issues.length,0);
  assert.equal(p.updates.length,31);
  assert.deepEqual(p.layoutChanges[0].after.rows[0],l.rows[0]);
  assert.deepEqual(p.layoutChanges[0].after.sections[0],custom);
  assert.equal(p.layoutChanges[0].after.sections[1].key,'area:G');
  assert.equal(p.layoutChanges[0].after.rows[1].areaCode,'G');
});

void test('a provisioned newcomer maps to an existing renamed area without replacing its catalog entry',()=>{
  const employee=provision().employees[0];
  const custom={key:'custom:g',group:'day',section:'G區',areaCode:'G',label:'管理員命名'};
  const l={...layout,id:'2026-10',monthKey:'2026-10',rows:[],sections:[custom]};
  const p=plan({source:[newEmployeeSource()],employees:[employee],layouts:[l]});
  assert.deepEqual(p.layoutChanges[0].after.sections,[custom]);
  assert.equal(p.layoutChanges[0].after.rows[0].sectionKey,'custom:g');
});

void test('source newcomer authorization can populate an empty manual layout while ordinary staff stay blocked',()=>{
  const l={...layout,id:'2026-10',monthKey:'2026-10',rows:[],sections:[],modifiedBy:'admin'};
  const sourceRows=[newEmployeeSource(),newEmployeeSource({employeeId:'B8888',name:'原有同仁'})];
  const p=plan({source:sourceRows,employees:[provision().employees[0],{...person,employeeId:'B8888',name:'原有同仁'}],layouts:[l]});
  assert.equal(p.updates.filter(u=>u.after.employeeId==='B9999').length,31);
  assert.equal(p.updates.filter(u=>u.after.employeeId==='B8888').length,0);
  assert.deepEqual(p.layoutChanges[0].after.rows.map(r=>r.employeeId),['B9999']);
});

void test('an explicitly excluded newcomer stays excluded even with source provisioning metadata',()=>{
  const l={...layout,id:'2026-10',monthKey:'2026-10',rows:[],sections:[],modifiedBy:'admin',excludedEmployeeIds:['B9999']};
  const p=plan({source:[newEmployeeSource()],employees:provision().employees,layouts:[l]});
  assert.equal(p.updates.length,0);
  assert.equal(p.layoutChanges.length,0);
  assert.equal(p.issues[0].reason,'explicitly-excluded-from-month');
});

void test('a newcomer is synced only from its selected source month onward without backfilling ended months',()=>{
  const sourceRows=[newEmployeeSource({month:'2026-09',codes:Array(30).fill('早G')}),newEmployeeSource()];
  const employees=provision({source:sourceRows}).employees;
  const p=plan({source:sourceRows,employees,layouts:[]});
  assert.equal(p.updates.length,31);
  assert.deepEqual(p.layoutChanges.map(l=>l.id),['2026-10']);
  assert.equal(p.issues.length,0);
  const records=p.updates.map(u=>({id:u.id,...u.after}));
  const repeated=plan({source:sourceRows,employees,records,layouts:p.layoutChanges.map(l=>l.after)});
  assert.equal(repeated.updates.length,0);
  assert.equal(repeated.layoutChanges.length,0);
});
