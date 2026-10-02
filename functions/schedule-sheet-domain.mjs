import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { preScheduleSource } from './pre-schedule-order.mjs';
import { initialMonthRows, monthSectionCatalog, monthRowSectionKey } from './month-schedule-layout.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';
const { parseCsv } = createRequire(import.meta.url)('./dispatch-block-parser.js');
export const SPREADSHEET_ID = '1yjd2qDw-uyrCvR9jt8KXJqukg7u7c93c9ad-niC1-UM';
export const FROM_DATE = '2026-09-01';
const clean = value => String(value ?? '').trim();
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function discoverSheets(html) {
  const found = [];
  for (const m of html.matchAll(/items\.push\(\{name:\s*"([^"\\]+)",\s*pageUrl:\s*"[^"]*",\s*gid:\s*"(\d+)"/g)) {
    const title = m[1].match(/^(9|10|11|12)月(日|夜)班$/);
    if (title) found.push({gid:m[2], title:m[1], month:`2026-${title[1].padStart(2,'0')}`, group:title[2]==='日'?'day':'night'});
  }
  if (!found.length) throw Error('找不到九月至十二月的日／夜班分頁，停止同步');
  if (new Set(found.map(s=>s.title)).size !== found.length) throw Error('班表分頁名稱重複');
  return found;
}

export function parseScheduleSheet(csv, sheet) {
  if (/<!doctype|<html/i.test(csv)) throw Error(`${sheet.title}: 來源不是班表 CSV`);
  const rows = parseCsv(csv);
  const headerIndex = rows.slice(0,8).findIndex(r=>r.includes('員工編號') && r.includes('姓名'));
  if (headerIndex < 1) throw Error(`${sheet.title}: 缺少員編／日期表頭`);
  const header = rows[headerIndex], dates = rows[headerIndex-1];
  const yearText = rows.slice(0,headerIndex).flat().map(clean);
  const years = yearText.flatMap(s=>[...s.matchAll(/(?:^|\D)(20\d{2}|1\d{2})(?=年|$)/g)].map(m=>Number(m[1]) < 1911 ? Number(m[1])+1911 : Number(m[1])));
  if (!years.length) throw Error(`${sheet.title}: 無法確認年份`);
  if (!years.includes(2026)) return null; // Older archived tabs are not this year's roster.
  const month = Number(sheet.month.slice(5)), count = new Date(Date.UTC(2026,month,0)).getUTCDate();
  const columns = Array.from({length:count},(_,i)=>dates.findIndex(d=>clean(d)===`${month}月${i+1}日`));
  if (columns.some(c=>c<0) || new Set(columns).size!==count) throw Error(`${sheet.title}: 日期欄不完整`);
  const idCol = header.indexOf('員工編號'), nameCol = header.indexOf('姓名'), titleCol=header.indexOf('職務名稱');
  let areaCode = null, section = '';
  const people = [];
  for (let index=headerIndex+1;index<rows.length;index++) {
    const row=rows[index], id=clean(row[idCol]).toUpperCase();
    const sectionHeader=row.slice(0,nameCol+1).map(clean).find(s=>/^(Z?[A-Z]+\d*)區|^(?:工兵小隊|B機動|晚PT數字|文書小秘)|監控/.test(s));
    if (sectionHeader && !/^[A-Z]?\d{4,6}$/.test(id)) {
      areaCode=sectionHeader.match(/^(Z?[A-Z]+\d*)區/)?.[1]||null;
      section=areaCode?`${areaCode}區`:sectionHeader.split(/[-－(（]/)[0].trim();
    }
    if (!/^[A-Z]?\d{4,6}$/.test(id) || !clean(row[nameCol])) continue;
    if (row.length <= Math.max(...columns)) throw Error(`${sheet.title}: 第 ${index+1} 列不完整`);
    const codes=columns.map(c=>clean(row[c]));
    if(codes.some(code=>code.length>120 || /^#(?:REF!|VALUE!|N\/A|ERROR!|DIV\/0!|NAME\?)/.test(code))) throw Error(`${sheet.title}: 第 ${index+1} 列含錯誤班碼`);
    people.push({employeeId:id,name:clean(row[nameCol]),title:clean(row[titleCol]),areaCode,section,group:sheet.group,month:sheet.month,codes});
  }
  if (!people.length) throw Error(`${sheet.title}: 無有效人員，停止同步`);
  return people;
}

// Detection time is the start of the highlight, never the sheet's roster month.
// Taiwan has no daylight saving transition, so calendar arithmetic uses UTC+8.
function onboardingDates(now) {
  const instant=now instanceof Date?new Date(now.getTime()):new Date(now);
  if(!Number.isFinite(instant.getTime()))throw Error('新進人員首次偵測時間不正確');
  const local=new Date(instant.getTime()+8*60*60*1000);
  const targetMonth=local.getUTCMonth()+3;
  const lastDay=new Date(Date.UTC(local.getUTCFullYear(),targetMonth+1,0)).getUTCDate();
  const until=new Date(Date.UTC(local.getUTCFullYear(),targetMonth,Math.min(local.getUTCDate(),lastDay),local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds(),local.getUTCMilliseconds())-8*60*60*1000);
  return {hireDate:local.toISOString().slice(0,10),onboardingStartedAt:instant.toISOString(),onboardingHighlightUntil:until.toISOString()};
}

export function planNewScheduleEmployees({source,employees,now=new Date()}) {
  const dates=onboardingDates(now), currentMonth=dates.hireDate.slice(0,7);
  const profiles=new Set(employees.map(p=>clean(p.employeeId||p.id).toUpperCase()));
  const grouped=new Map(), proposed=[], issues=[];
  const validMonths=source.map(r=>clean(r.month)).filter(m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m));
  const latestMonth=validMonths.sort().at(-1);
  for(const row of source) {
    const id=clean(row.employeeId).toUpperCase();
    if(profiles.has(id))continue; // Existing and inactive profiles are never changed.
    if(!grouped.has(id))grouped.set(id,[]);
    grouped.get(id).push(row);
  }
  for(const [employeeId,rows] of grouped) {
    if(!/^[A-Z]?\d{4,6}$/.test(employeeId)){issues.push({employeeId,reason:'invalid-source-employee-id'});continue;}
    const months=rows.map(r=>clean(r.month));
    if(months.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))){issues.push({employeeId,reason:'invalid-source-month'});continue;}
    const month=months.sort().at(-1);
    if(month<currentMonth) {
      issues.push({employeeId,month,latestMonth:latestMonth||null,currentMonth,reason:'not-in-current-source-month'});
      continue;
    }
    const names=[...new Set(rows.map(r=>clean(r.name)))];
    if(names.length!==1 || !names[0] || names[0].length>100){issues.push({employeeId,month,reason:'conflicting-source-names'});continue;}
    const selected=rows.filter(r=>clean(r.month)===month);
    const groups=[...new Set(selected.map(r=>r.group))];
    if(groups.length!==1 || !['day','night'].includes(groups[0])){issues.push({employeeId,month,reason:'ambiguous-source-group'});continue;}
    const placements=selected.map(row=>{
      const section=clean(row.section), areaCode=clean(row.areaCode).toUpperCase();
      const identity=scheduleSectionIdentity(section,areaCode,row.group);
      const trusted=(section || /^[A-Z]+\d*$/.test(areaCode)) && section.length<=100 && (!areaCode || /^[A-Z]+\d*$/.test(areaCode)) && (!areaCode || !identity.areaCode || areaCode===identity.areaCode);
      return {trusted,section:section||`${areaCode}區`,identity};
    });
    if(placements.some(p=>!p.trusted)){issues.push({employeeId,month,reason:'unmapped-source-area'});continue;}
    if(new Set(placements.map(p=>p.identity.key)).size!==1){issues.push({employeeId,month,reason:'ambiguous-source-area'});continue;}
    const placement=placements[0];
    const title=clean(selected.find(r=>clean(r.title))?.title)||'調度專員';
    if(title.length>100){issues.push({employeeId,month,reason:'invalid-source-title'});continue;}
    proposed.push({employeeId,name:names[0],title,group:groups[0],section:placement.section,areaCode:placement.identity.areaCode,role:'employee',active:true,mustChangePassword:true,...dates,hireDateSource:'schedule-first-seen',scheduleSourceMonth:month,source:'google-schedule-sync'});
  }
  return {employees:proposed,issues};
}

function sectionFamily(key, areaCode) {
  // PT/support sections retain their distinct identity even if an old row has
  // a stale area code. Labels and daily work codes never determine placement.
  if(String(key).startsWith('section:'))return `section:${key}`;
  const code=clean(areaCode).toUpperCase();
  const family=/^ZH\d*$/.test(code)?'ZH':code.match(/^Z?([A-X])\d*$/)?.[1]||code.match(/^([A-Z]+)\d*$/)?.[1];
  return family?`family:${family}`:`section:${key}`;
}

function groupAdjacentSections(items, sectionOf) {
  const groups=new Map();
  for(const item of items) {
    const {group,key,areaCode}=sectionOf(item);
    if(!groups.has(group))groups.set(group,new Map());
    const families=groups.get(group), family=sectionFamily(key,areaCode);
    if(!families.has(family))families.set(family,new Map());
    const sections=families.get(family);
    if(!sections.has(key))sections.set(key,[]);
    sections.get(key).push(item);
  }
  // Map insertion order retains the first appearance of each group, family
  // and exact section, plus the existing manual order inside each section.
  return [...groups.values()].flatMap(families=>[...families.values()].flatMap(sections=>[...sections.values()].flat()));
}

function orderedMonthLayout(layout) {
  const catalog=new Map(monthSectionCatalog(layout.rows,layout).map(s=>[`${s.group}:${s.key}`,s]));
  const rows=groupAdjacentSections(layout.rows,row=>{
    const key=monthRowSectionKey(row), section=catalog.get(`${row.group}:${key}`);
    return {group:row.group,key,areaCode:section?section.areaCode:row.areaCode};
  });
  return {...layout,rows,...(layout.sections?{sections:groupAdjacentSections(layout.sections,s=>s)}:{})};
}

// Layout-only reconciliation is safe when source cells have not changed. It
// neither provisions staff nor alters membership, blank days, or section data.
export function planScheduleLayoutOrder(layouts) {
  const changes=[];
  for(const before of layouts) {
    const after=orderedMonthLayout(before);
    if(JSON.stringify(before.rows)===JSON.stringify(after.rows) && JSON.stringify(before.sections)===JSON.stringify(after.sections))continue;
    changes.push({id:before.monthKey||before.id,before,after});
  }
  return changes;
}

function sourceOrderedSections(sections, source) {
  const ranks=new Map(), groups=new Map();
  for(const row of source) {
    const sourceSection=row.section || (preScheduleSource(row.employeeId)?.group===row.group?preScheduleSource(row.employeeId)?.section:'');
    const key=scheduleSectionIdentity(sourceSection,row.areaCode||'',row.group).key;
    if(!ranks.has(row.group))ranks.set(row.group,new Map());
    const order=ranks.get(row.group);
    if(!order.has(key))order.set(key,order.size);
  }
  for(const section of sections) {
    if(!groups.has(section.group))groups.set(section.group,[]);
    groups.get(section.group).push(section);
  }
  return [...groups].flatMap(([group,items])=>items.sort((a,b)=>(ranks.get(group)?.get(a.key)??Infinity)-(ranks.get(group)?.get(b.key)??Infinity)));
}

export function planScheduleSync({source, employees, records, layouts}) {
  const profiles=new Map(employees.map(p=>[p.employeeId||p.id,p]));
  const layoutMap=new Map(layouts.map(l=>[l.monthKey||l.id,l]));
  const recordMap=new Map(), duplicates=new Set();
  for(const r of records) {const key=`${r.employeeId}_${r.date}`;if(recordMap.has(key))duplicates.add(key);else recordMap.set(key,r);}
  const grouped=new Map(), issues=[], layoutChanges=[], updates=[];
  for(const row of source) {
    const key=`${row.month}:${row.employeeId}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(row);
  }
  const nextLayouts=new Map(), bootstrapMonths=new Set();
  const sourceMonths=new Set(source.map(r=>r.month).filter(m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m)));
  for(const rows of grouped.values()) {
    const first=rows[0], id=first.employeeId, month=first.month, person=profiles.get(id);
    if(!person || person.active!==true){issues.push({employeeId:id,month,reason:'missing-or-inactive-employee'});continue;}
    if(person.source==='google-schedule-sync' && person.scheduleSourceMonth && month<person.scheduleSourceMonth)continue;
    const existingLayout=layoutMap.get(month);
    if(existingLayout?.excludedEmployeeIds?.includes(id)){issues.push({employeeId:id,month,reason:'explicitly-excluded-from-month'});continue;}
    const existingRow=existingLayout?.rows.find(r=>r.employeeId===id);
    const existingRecords=records.filter(r=>r.employeeId===id && r.date.startsWith(month));
    const groups=[...new Set(rows.map(r=>r.group))];
    const group=existingRow?.group || (existingRecords[0]?.shiftType==='morning'?'day':existingRecords[0]?.shiftType==='night'?'night':null) || (groups.length===1?groups[0]:preScheduleSource(id)?.group);
    const selected=rows.filter(r=>r.group===(group||groups[0]));
    if(!selected.length || (!group && groups.length>1)){issues.push({employeeId:id,month,reason:'ambiguous-source-group'});continue;}
    if(selected.some(r=>r.name!==selected[0].name)){issues.push({employeeId:id,month,reason:'conflicting-source-names'});continue;}
    // A newly published month has no app records from which to infer sections.
    // Only bootstrap new layouts or the empty layout produced by the old sync.
    const bootstrap=!existingLayout || (existingLayout.modifiedBy==='google-schedule-sync' && !existingLayout.rows.length && !existingLayout.sections && !existingLayout.excludedEmployeeIds?.length && !Object.keys(existingLayout.assignmentResetAt||{}).length);
    if(bootstrap)bootstrapMonths.add(month);
    let next=nextLayouts.get(month);
    if(!next) {
      const base=existingLayout || {monthKey:month,revision:0,rows:initialMonthRows(employees.filter(p=>records.some(r=>r.employeeId===(p.employeeId||p.id)&&r.date.startsWith(month))).map(p=>({...p,employeeId:p.employeeId||p.id}))),excludedEmployeeIds:[]};
      next=structuredClone(base);
      if(bootstrap)next.sections=monthSectionCatalog(next.rows,next);
    }
    let target=next.rows.find(r=>r.employeeId===id);
    if(!target || (bootstrap && !existingRow)) {
      const candidate=selected[0];
      const provisioned=person.source==='google-schedule-sync' && !!person.onboardingStartedAt;
      // Newcomers may introduce a source section, but its creation must not
      // authorize ordinary staff to return to a section missing from the
      // administrator's original catalog during the same sync pass.
      const sections=!bootstrap && !provisioned?monthSectionCatalog(existingLayout.rows,existingLayout):monthSectionCatalog(next.rows,next);
      const sourceSection=candidate.section || (preScheduleSource(id)?.group===candidate.group?preScheduleSource(id)?.section:'');
      const identity=scheduleSectionIdentity(sourceSection,candidate.areaCode||'',candidate.group);
      let section=sections.find(s=>s.group===candidate.group && (s.key===identity.key || (candidate.areaCode && s.areaCode===candidate.areaCode)));
      // The employee provisioner explicitly authorizes placement in its source
      // section. The scope does not extend to existing manually managed staff.
      const canExtend=provisioned;
      if(!section && (bootstrap || canExtend) && (sourceSection || candidate.areaCode)) {
        section={key:identity.key,group:candidate.group,section:sourceSection||`${candidate.areaCode}區`,areaCode:identity.areaCode,label:identity.label};
        if(!next.sections)next.sections=sections;
        next.sections.push(section);
      }
      if(!section){issues.push({employeeId:id,month,reason:'unmapped-source-area'});continue;}
      if(target)next.rows.splice(next.rows.indexOf(target),1);
      target={employeeId:id,group:candidate.group,section:section.section,sectionKey:section.key,areaCode:section.areaCode,blankDays:[]};
      const last=next.rows.findLastIndex(r=>r.group===target.group && monthRowSectionKey(r)===target.sectionKey);
      next.rows.splice(last<0?next.rows.length:last+1,0,target);
    }
    nextLayouts.set(month,next);
    const count=selected[0].codes.length;
    for(let i=0;i<count;i++) {
      const date=`${month}-${String(i+1).padStart(2,'0')}`;
      if(date<FROM_DATE)continue;
      const key=`${id}_${date}`;
      if(duplicates.has(key)){issues.push({employeeId:id,date,reason:'duplicate-app-records'});continue;}
      const code=[...new Set(selected.map(r=>r.codes[i]).filter(Boolean))].join('／');
      target.blankDays=(target.blankDays||[]).filter(d=>d!==String(i+1));
      const before=recordMap.get(key);
      const values={scheduleCode:code,scheduleLabel:code,leaveType:/^(例|休|慰|病|病假|事|事假|特休|假|公假|國假|喪假|婚假|家庭照顧|生理假)$/.test(code)?code:''};
      if(before && Object.entries(values).every(([k,v])=>(before[k]||'')===v))continue;
      const after=before ? values : {...values,date,employeeId:id,employeeName:person.name,shiftType:target.group==='day'?'morning':'night',source:'google-schedule-sync',status:'active',note:''};
      updates.push({id:before?.id||key,before:before||null,after});
    }
  }
  // Reconcile the catalog as well as rows: both schedule views render sections
  // in catalog order, and new source subareas previously landed at its tail.
  for(const [month,current] of new Map([...layoutMap,...nextLayouts])) {
    if(!sourceMonths.has(month))continue;
    // A person appearing in both tabs enters grouped at its day-tab position.
    // New month catalogs must instead follow each selected source tab's own
    // section order. Existing catalogs keep their manual first-appearance order.
    const base=bootstrapMonths.has(month)&&current.sections?{...current,sections:sourceOrderedSections(current.sections,source.filter(r=>r.month===month))}:current;
    const next=orderedMonthLayout(base);
    const old=layoutMap.get(month);
    if(old && JSON.stringify(old.rows)===JSON.stringify(next.rows) && JSON.stringify(old.sections)===JSON.stringify(next.sections))continue;
    layoutChanges.push({id:month,before:old||null,after:next});
  }
  return {updates,layoutChanges,issues,cleared:updates.filter(u=>u.before?.scheduleCode && !u.after.scheduleCode).length};
}
