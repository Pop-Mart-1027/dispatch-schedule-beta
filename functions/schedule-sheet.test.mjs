import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScheduleSheet,discoverSheets,planScheduleSync,planNewScheduleEmployees,planScheduleLayoutOrder} from './schedule-sheet-domain.mjs';
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

const orderSection=(areaCode,group='day',extra={})=>({key:`area:${areaCode}`,group,section:`${areaCode}區`,areaCode,label:`${areaCode}區`,...extra});
const orderRow=(employeeId,areaCode,group='day',extra={})=>({employeeId,group,section:`${areaCode}區`,areaCode,sectionKey:`area:${areaCode}`,blankDays:[],...extra});

void test('a newly published source subarea joins its existing family instead of landing after another area',()=>{
  for(const [first,last] of [['O1','O4'],['W2','W3'],['A2','A1'],['ZH1','ZH2']]) {
    const old={monthKey:'2026-10',revision:4,rows:[orderRow('B8001',first),orderRow('B8002','R')],sections:[orderSection(first),orderSection('R')],excludedEmployeeIds:[]};
    const sourceRows=[newEmployeeSource({section:`${last}區`,areaCode:last})];
    const employees=provision({source:sourceRows}).employees;
    const p=plan({source:sourceRows,employees,layouts:[old]});
    assert.equal(p.issues.length,0);
    assert.deepEqual(p.layoutChanges[0].after.sections.map(s=>s.areaCode),[first,last,'R']);
    assert.deepEqual(p.layoutChanges[0].after.rows.map(r=>r.employeeId),['B8001','B9999','B8002']);
    assert.equal(p.updates.length,31);
    assert.equal(employees[0].onboardingHighlightUntil,'2027-01-02T03:00:00.000Z');
  }
});

void test('layout order repair makes families and exact subareas adjacent without alphabetizing manual order',()=>{
  const boss={key:'section:單位主官',group:'day',section:'單位主官',areaCode:null,label:'單位主官'};
  const sections=[boss,orderSection('O2','day',{label:'手動命名O小區',customNote:'keep'}),orderSection('R'),orderSection('O1'),orderSection('A2'),orderSection('A1'),orderSection('O4')];
  const rows=[
    orderRow('chief',null,'day',{section:'單位主官',sectionKey:boss.key,fixed:true}),
    orderRow('o2-first','O2'),orderRow('r-first','R'),orderRow('o1-first','O1'),
    orderRow('o2-second','O2','day',{blankDays:['2','3'],note:'manual order'}),
    orderRow('a2-first','A2'),orderRow('a1-first','A1'),orderRow('o4-first','O4'),
  ];
  const old={monthKey:'2026-10',revision:8,rows,sections,excludedEmployeeIds:['removed'],customMetadata:{keep:true}};
  const original=structuredClone(old);
  const p=planScheduleLayoutOrder([old]);
  assert.equal(p.length,1);
  assert.equal(p[0].before,old);
  assert.deepEqual(p[0].after.sections.map(s=>s.key),[boss.key,'area:O2','area:O1','area:O4','area:R','area:A2','area:A1']);
  assert.deepEqual(p[0].after.rows.map(r=>r.employeeId),['chief','o2-first','o2-second','o1-first','o4-first','r-first','a2-first','a1-first']);
  for(const row of old.rows)assert.deepEqual(p[0].after.rows.find(r=>r.employeeId===row.employeeId),row);
  for(const section of old.sections)assert.deepEqual(p[0].after.sections.find(s=>s.key===section.key),section);
  assert.deepEqual(old,original);
  assert.equal(p[0].after.revision,8);
  assert.equal(p[0].after.customMetadata,old.customMetadata);
  assert.deepEqual(planScheduleLayoutOrder([p[0].after]),[]);
});

void test('day and night section families remain separate and each keeps its internal order',()=>{
  const rows=[orderRow('n-o1','O1','night'),orderRow('d-o4','O4'),orderRow('n-r','R','night'),orderRow('d-r','R'),orderRow('n-o4','O4','night'),orderRow('d-o1','O1')];
  const sections=rows.map(r=>orderSection(r.areaCode,r.group));
  const p=planScheduleLayoutOrder([{monthKey:'2026-10',rows,sections}])[0].after;
  assert.deepEqual(p.rows.map(r=>r.employeeId),['n-o1','n-o4','n-r','d-o4','d-o1','d-r']);
  assert.deepEqual(p.sections.map(s=>`${s.group}:${s.areaCode}`),['night:O1','night:O4','night:R','day:O4','day:O1','day:R']);
});

void test('special and custom section keys never merge into a similarly named area family',()=>{
  const support={key:'section:B區PT',group:'day',section:'B機動',areaCode:null,label:'B區PT'};
  const custom={key:'custom:o',group:'day',section:'支援',areaCode:null,label:'O4區'};
  const sections=[orderSection('O1'),support,orderSection('R'),custom,orderSection('O4'),orderSection('B1')];
  const rows=[orderRow('o1','O1'),orderRow('pt','B','day',{section:'B機動',sectionKey:support.key}),orderRow('r','R'),orderRow('custom','O4','day',{section:'支援',sectionKey:custom.key}),orderRow('o4','O4'),orderRow('b1','B1')];
  const p=planScheduleLayoutOrder([{monthKey:'2026-10',rows,sections}])[0].after;
  assert.deepEqual(p.sections.map(s=>s.key),['area:O1','area:O4',support.key,'area:R',custom.key,'area:B1']);
  assert.deepEqual(p.rows.map(r=>r.employeeId),['o1','o4','pt','r','custom','b1']);
});

void test('layout order repair retains empty areas, blank rows, exclusions and untouched metadata',()=>{
  const stamp={toDate:()=>new Date('2026-10-01T00:00:00Z')};
  const rows=[orderRow('o1','O1'),orderRow('','R','day',{blankDays:['1','2','31'],placeholder:true}),orderRow('o4','O4')];
  const old={monthKey:'2026-10',revision:9,rows,sections:[orderSection('O1'),orderSection('R'),orderSection('O2','day',{label:'空小區'}),orderSection('O4')],excludedEmployeeIds:['removed'],assignmentResetAt:{'2026-10-01':{O1:stamp}},createdAt:stamp};
  const p=planScheduleLayoutOrder([old])[0].after;
  assert.deepEqual(p.sections.map(s=>s.areaCode),['O1','O2','O4','R']);
  assert.deepEqual(p.rows.map(r=>r.employeeId),['o1','o4','']);
  assert.deepEqual(p.rows[2],old.rows[1]);
  assert.equal(p.assignmentResetAt,old.assignmentResetAt);
  assert.equal(p.createdAt,stamp);
  assert.equal(p.excludedEmployeeIds,old.excludedEmployeeIds);
  assert.equal(p.rows.length,old.rows.length);
});

void test('layouts without persisted catalogs repair row families without adding a catalog',()=>{
  const old={monthKey:'2026-10',rows:[orderRow('o1','O1'),orderRow('r','R'),orderRow('o4','O4')],revision:1};
  const p=planScheduleLayoutOrder([old])[0].after;
  assert.deepEqual(p.rows.map(r=>r.employeeId),['o1','o4','r']);
  assert.equal(Object.hasOwn(p,'sections'),false);
});

void test('a full sync repairs catalog order even when all source cell values are unchanged',()=>{
  const sourceRows=[newEmployeeSource({employeeId:'B8001',areaCode:'O1',section:'O1區'})];
  const old={monthKey:'2026-10',revision:3,rows:[orderRow('B8001','O1'),orderRow('B8002','R'),orderRow('B8003','O4')],sections:[orderSection('O1'),orderSection('R'),orderSection('O4')]};
  const employees=[{...person,employeeId:'B8001'}];
  const records=Array.from({length:31},(_,i)=>({id:`r${i+1}`,employeeId:'B8001',date:`2026-10-${String(i+1).padStart(2,'0')}`,scheduleCode:'早G',scheduleLabel:'早G',leaveType:'',shiftType:'morning'}));
  const p=plan({source:sourceRows,employees,records,layouts:[old]});
  assert.equal(p.updates.length,0);
  assert.equal(p.layoutChanges.length,1);
  assert.deepEqual(p.layoutChanges[0].after.sections.map(s=>s.areaCode),['O1','O4','R']);
  assert.equal(plan({source:sourceRows,employees,records,layouts:[p.layoutChanges[0].after]}).layoutChanges.length,0);
});

function doubleTabOrderFixture(month) {
  const days=new Date(Date.UTC(2026,Number(month.slice(5)),0)).getUTCDate();
  const ids=['B8001','B8002','B8003'];
  const employees=ids.map((employeeId,i)=>({...person,employeeId,name:`員工${i}`,group:'night',section:i===0?'O4區':i===1?'R區':'O1區',areaCode:i===0?'O4':i===1?'R':'O1'}));
  const make=(index,group,areaCode)=>newEmployeeSource({employeeId:ids[index],name:employees[index].name,month,group,areaCode,section:`${areaCode}區`,codes:Array(days).fill(group==='night'?`夜${areaCode}`:`早${areaCode}`)});
  // The day tab introduces two night staff before their real night-tab order.
  const source=[make(0,'day','S'),make(1,'day','S'),make(2,'night','O1'),make(0,'night','O4'),make(1,'night','R')];
  const records=employees.slice(0,2).map(e=>({id:e.employeeId,employeeId:e.employeeId,date:`${month}-01`,shiftType:'night',scheduleCode:'休'}));
  return {employees,source,records};
}

for(const month of ['2026-11','2026-12']) {
  void test(`new ${month} section order follows each source tab despite earlier duplicate day-tab people`,()=>{
    const {employees,source,records}=doubleTabOrderFixture(month);
    const p=plan({source,employees,records,layouts:[]});
    assert.equal(p.issues.length,0);
    assert.deepEqual(p.layoutChanges[0].after.sections.map(s=>`${s.group}:${s.areaCode}`),['night:O1','night:O4','night:R']);
    assert.equal(new Set(p.layoutChanges[0].after.rows.map(r=>r.employeeId)).size,3);
  });
}

void test('existing month families retain their catalog first-appearance order instead of adopting the source order',()=>{
  const {employees,source,records}=doubleTabOrderFixture('2026-11');
  const old={monthKey:'2026-11',revision:7,rows:[orderRow('B8001','O4','night'),orderRow('B8002','R','night'),orderRow('B8003','O1','night')],sections:[orderSection('O4','night',{label:'自訂O4'}),orderSection('R','night'),orderSection('O1','night')]};
  const p=plan({source,employees,records,layouts:[old]});
  assert.deepEqual(p.layoutChanges[0].after.sections.map(s=>s.areaCode),['O4','O1','R']);
  assert.equal(p.layoutChanges[0].after.sections[0].label,'自訂O4');
});

void test('full sync ordering does not touch an unpublished or historical manual month',()=>{
  const old={monthKey:'2026-08',revision:3,rows:[orderRow('o1','O1'),orderRow('r','R'),orderRow('o4','O4')],sections:[orderSection('O1'),orderSection('R'),orderSection('O4')],modifiedBy:'admin'};
  const p=plan({layouts:[layout,old]});
  assert.equal(p.layoutChanges.some(l=>l.id==='2026-08'),false);
  assert.deepEqual(old.sections.map(s=>s.areaCode),['O1','R','O4']);
});
