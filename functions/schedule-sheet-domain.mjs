import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { preScheduleSource } from './pre-schedule-order.mjs';
import { initialMonthRows, monthSectionCatalog } from './month-schedule-layout.mjs';
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
  if (!found.some(s=>s.title==='9月日班') || !found.some(s=>s.title==='9月夜班')) throw Error('找不到已確認的九月日／夜班分頁，停止同步');
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
    const areaHeader=row.slice(0,nameCol+1).map(clean).find(s=>/^(Z?[A-Z]+\d*)區(?:[-－\s]|$)/.test(s));
    if (areaHeader && !/^[A-Z]?\d{4,6}$/.test(id)) {
      areaCode=areaHeader.match(/^(Z?[A-Z]+\d*)區/)[1]; section=`${areaCode}區`;
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
  const nextLayouts=new Map();
  for(const rows of grouped.values()) {
    const first=rows[0], id=first.employeeId, month=first.month, person=profiles.get(id);
    if(!person || person.active!==true){issues.push({employeeId:id,month,reason:'missing-or-inactive-employee'});continue;}
    const existingLayout=layoutMap.get(month);
    if(existingLayout?.excludedEmployeeIds?.includes(id)){issues.push({employeeId:id,month,reason:'explicitly-excluded-from-month'});continue;}
    const existingRow=existingLayout?.rows.find(r=>r.employeeId===id);
    const existingRecords=records.filter(r=>r.employeeId===id && r.date.startsWith(month));
    const group=existingRow?.group || preScheduleSource(id)?.group || (existingRecords[0]?.shiftType==='morning'?'day':existingRecords[0]?.shiftType==='night'?'night':null);
    const groups=[...new Set(rows.map(r=>r.group))];
    const selected=rows.filter(r=>r.group===(group||groups[0]));
    if(!selected.length || (!group && groups.length>1)){issues.push({employeeId:id,month,reason:'ambiguous-source-group'});continue;}
    if(selected.some(r=>r.name!==selected[0].name)){issues.push({employeeId:id,month,reason:'conflicting-source-names'});continue;}
    if(!nextLayouts.has(month)) {
      const base=existingLayout || {monthKey:month,revision:0,rows:initialMonthRows(employees.filter(p=>records.some(r=>r.employeeId===(p.employeeId||p.id)&&r.date.startsWith(month))).map(p=>({...p,employeeId:p.employeeId||p.id}))),excludedEmployeeIds:[]};
      nextLayouts.set(month,structuredClone(base));
    }
    const next=nextLayouts.get(month);
    let target=next.rows.find(r=>r.employeeId===id);
    if(!target) {
      const candidate=selected[0];
      const sections=monthSectionCatalog(next.rows,next);
      const section=sections.find(s=>s.group===candidate.group && candidate.areaCode && s.areaCode===candidate.areaCode);
      if(!section){issues.push({employeeId:id,month,reason:'unmapped-source-area'});continue;}
      target={employeeId:id,group:candidate.group,section:section.section,sectionKey:section.key,areaCode:section.areaCode,blankDays:[]};
      const last=next.rows.findLastIndex(r=>r.group===target.group && (r.sectionKey===target.sectionKey || (!r.sectionKey && r.areaCode===target.areaCode)));
      next.rows.splice(last<0?next.rows.length:last+1,0,target);
    }
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
  for(const [month,next] of nextLayouts) {
    const old=layoutMap.get(month);
    if(old && JSON.stringify(old.rows)===JSON.stringify(next.rows))continue;
    layoutChanges.push({id:month,before:old||null,after:next});
  }
  return {updates,layoutChanges,issues,cleared:updates.filter(u=>u.before?.scheduleCode && !u.after.scheduleCode).length};
}
