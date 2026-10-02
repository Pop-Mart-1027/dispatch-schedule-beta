import { randomUUID } from 'node:crypto';
import { SPREADSHEET_ID, discoverSheets, parseScheduleSheet, planScheduleSync, planScheduleLayoutOrder, planNewScheduleEmployees, digest } from './schedule-sheet-domain.mjs';

// Re-plan unchanged source after fixes to discovery or month initialization.
// Ordering is checked separately on every run, without replaying schedule cells.
export const SCHEDULE_SYNC_SCHEMA_VERSION = 3;
const ISSUE_RETRY_INTERVAL_MS = 15 * 60 * 1000;

export function createScheduleSheetSync({db,FieldValue,fetch:fetchSource=fetch,provisionEmployee,now=()=>new Date()}) {
  const control=db.collection('scheduleSheetSync').doc('control');
  const readSource=async()=>{
    const read=async url=>{const r=await fetchSource(url,{signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error(`試算表讀取失敗 HTTP ${r.status}`);return r.text();};
    const base=`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
    const sheets=discoverSheets(await read(`${base}/htmlview`));
    const source=[];
    for(const sheet of sheets) {
      const rows=parseScheduleSheet(await read(`${base}/export?format=csv&gid=${sheet.gid}`),sheet);
      if(rows)source.push(...rows);
    }
    if(!source.length)throw Error('找不到 2026 年的有效班表，停止同步');
    return source;
  };
  const readState=async()=>{
    const [people,records,layouts]=await Promise.all([
      db.collection('employees').get(),
      db.collection('scheduleRecords').where('date','>=','2026-09-01').get(),
      db.collection('scheduleMonthLayouts').get(),
    ]);
    return {employees:people.docs.map(d=>({...d.data(),employeeId:d.id})),records:records.docs.map(d=>({...d.data(),id:d.id})),layouts:layouts.docs.map(d=>({...d.data(),id:d.id}))};
  };
  const employeePlan=(source,state)=>typeof provisionEmployee==='function'?planNewScheduleEmployees({source,employees:state.employees,now:now()}):{employees:[],issues:[]};
  const combinePlan=(source,state,newPeople,extraIssues=[])=>{
    const plan=planScheduleSync({source,...state,employees:[...state.employees,...newPeople]});
    const explained=new Set(extraIssues.map(i=>`${i.month}:${i.employeeId}`));
    plan.issues=[...plan.issues.filter(i=>i.reason!=='missing-or-inactive-employee'||!explained.has(`${i.month}:${i.employeeId}`)),...extraIssues];
    return plan;
  };
  const preview=async source=>{
    const state=await readState(),newPeople=employeePlan(source,state);
    return {...combinePlan(source,state,newPeople.employees,newPeople.issues),createdEmployees:newPeople.employees.length};
  };
  const summary=plan=>({changed:plan.updates.length,layouts:plan.layoutChanges.length,cleared:plan.cleared,createdEmployees:plan.createdEmployees||0,issues:plan.issues.slice(0,100),issueCount:plan.issues.length});
  async function applyPlan(plan,runId) {
    const tasks=[...plan.layoutChanges.map(x=>({...x,collection:'scheduleMonthLayouts'})),...plan.updates.map(x=>({...x,collection:'scheduleRecords'}))];
    for(let offset=0;offset<tasks.length;offset+=100) {
      const batch=tasks.slice(offset,offset+100);
      await db.runTransaction(async tx=>{
        const c=(await tx.get(control)).data();
        if(!c?.enabled || c.runId!==runId)throw Error('同步已暫停或執行權已變更');
        const refs=batch.map(t=>db.collection(t.collection).doc(t.id));
        const snapshots=await tx.getAll(...refs);
        for(let i=0;i<batch.length;i++) {
          const task=batch[i], before=snapshots[i].exists?snapshots[i].data():null;
          if(task.collection==='scheduleMonthLayouts' && (before?.revision||0)!==(task.before?.revision||0))throw Error('月份配置已被修改，下一輪重新比對');
          // Preserve existing metadata and only write the projected layout arrays.
          const values=task.collection==='scheduleMonthLayouts' && before ? {
            rows:task.after.rows,
            ...(task.after.sections!==undefined ? {sections:task.after.sections} : {}),
          } : task.after;
          const after={...values,updatedAt:FieldValue.serverTimestamp(),modifiedBy:'google-schedule-sync'};
          delete after.id;
          if(task.collection==='scheduleMonthLayouts')after.revision=(before?.revision||0)+1;
          if(!before)after.createdAt=FieldValue.serverTimestamp();
          tx.set(refs[i],after,{merge:true});
          tx.set(db.collection('scheduleSheetSyncRuns').doc(runId).collection('changes').doc(`${task.collection}_${task.id}`),{path:refs[i].path,before,after:task.after,createdAt:FieldValue.serverTimestamp()});
        }
        tx.update(control,{leaseUntil:Date.now()+480000});
      });
    }
  }
  async function run() {
    const runId=randomUUID();
    const claimed=await db.runTransaction(async tx=>{
      const s=await tx.get(control),c=s.data();
      if(!c?.enabled || c.leaseUntil>Date.now())return false;
      tx.update(control,{runId,leaseUntil:Date.now()+480000});return true;
    });
    if(!claimed)return {skipped:true};
    try {
      const source=await readSource(), hash=digest(source);
      const state=(await control.get()).data();
      // Check layout order on every run, including unchanged sheet contents.
      // Unresolved employees still retry periodically without full roster reads.
      const issueRetryDue=state.lastResult?.issueCount>0 && !(state.nextIssueRetryAt>Date.now());
      if(state.sourceHash===hash && state.sourceSchemaVersion===SCHEDULE_SYNC_SCHEMA_VERSION && !issueRetryDue) {
        const months=new Set(source.map(row=>row.month));
        const layouts=(await db.collection('scheduleMonthLayouts').get()).docs.map(d=>({...d.data(),id:d.id})).filter(layout=>months.has(layout.monthKey||layout.id));
        const layoutChanges=planScheduleLayoutOrder(layouts);
        await applyPlan({layoutChanges,updates:[]},runId);
        const result=layoutChanges.length ? {changed:0,layouts:layoutChanges.length,cleared:0,createdEmployees:0,issues:state.lastResult?.issues||[],issueCount:state.lastResult?.issueCount||0,orderingOnly:true} : {unchanged:true};
        await db.runTransaction(async tx=>{
          const c=(await tx.get(control)).data();
          if(!c?.enabled || c.runId!==runId)throw Error('同步已暫停或執行權已變更');
          tx.update(control,{lastCheckedAt:FieldValue.serverTimestamp(),lastError:'',leaseUntil:0,...(layoutChanges.length?{lastSuccessAt:FieldValue.serverTimestamp(),lastResult:result}:{})});
          if(layoutChanges.length)tx.set(db.collection('scheduleSheetSyncRuns').doc(runId),{...result,sourceHash:hash,sourceSchemaVersion:SCHEDULE_SYNC_SCHEMA_VERSION,completedAt:FieldValue.serverTimestamp()});
        });
        return result;
      }
      const stateData=await readState(),newPeople=employeePlan(source,stateData);
      const projected=combinePlan(source,stateData,newPeople.employees,newPeople.issues);
      // Fail closed on bulk clearing; an administrator must inspect the source first.
      if(projected.cleared>100)throw Error(`來源將清空 ${projected.cleared} 格，已停止自動套用，請管理員核對`);
      let createdEmployees=0;
      const employeeIssues=[...newPeople.issues];
      for(const candidate of newPeople.employees) {
        const ref=db.collection('employees').doc(candidate.employeeId);
        const existing=await db.runTransaction(async tx=>{
          const c=(await tx.get(control)).data();
          if(!c?.enabled||c.runId!==runId)throw Error('同步已暫停或執行權已變更');
          const snapshot=await tx.get(ref);
          return snapshot.exists?snapshot.data():null;
        });
        if(existing) {
          stateData.employees.push({...existing,employeeId:candidate.employeeId});
          continue;
        }
        try {
          await provisionEmployee(candidate,{runId});
        } catch(error) {
          if(error.code!=='auth-account-conflict')throw error;
          employeeIssues.push({employeeId:candidate.employeeId,month:candidate.scheduleSourceMonth,reason:'auth-account-conflict'});
          continue;
        }
        const saved=await db.runTransaction(async tx=>{
          const c=(await tx.get(control)).data();
          if(!c?.enabled||c.runId!==runId)throw Error('同步已暫停或執行權已變更');
          const snapshot=await tx.get(ref);
          if(snapshot.exists)return {created:false,profile:snapshot.data()};
          const profile={...candidate,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),modifiedBy:'google-schedule-sync'};
          tx.set(ref,profile);
          tx.set(db.collection('scheduleSheetSyncRuns').doc(runId).collection('changes').doc(`employees_${candidate.employeeId}`),{path:ref.path,before:null,after:candidate,createdAt:FieldValue.serverTimestamp()});
          tx.set(db.collection('auditLogs').doc(`schedule_employee_${runId}_${candidate.employeeId}`),{action:'employee.auto-created',actorId:'google-schedule-sync',targetId:candidate.employeeId,details:{group:candidate.group,section:candidate.section,areaCode:candidate.areaCode,onboardingStartedAt:candidate.onboardingStartedAt,onboardingHighlightUntil:candidate.onboardingHighlightUntil},createdAt:FieldValue.serverTimestamp()});
          tx.update(control,{leaseUntil:Date.now()+480000});
          return {created:true,profile};
        });
        if(saved.created)createdEmployees++;
        stateData.employees.push({...saved.profile,employeeId:candidate.employeeId});
      }
      const plan={...combinePlan(source,stateData,[],employeeIssues),createdEmployees};
      if(plan.cleared>100)throw Error(`來源將清空 ${plan.cleared} 格，已停止自動套用，請管理員核對`);
      await applyPlan(plan,runId);
      const result=summary(plan);
      await db.runTransaction(async tx=>{
        const c=(await tx.get(control)).data();if(c?.runId!==runId)return;
        tx.update(control,{sourceHash:hash,sourceSchemaVersion:SCHEDULE_SYNC_SCHEMA_VERSION,nextIssueRetryAt:result.issueCount?Date.now()+ISSUE_RETRY_INTERVAL_MS:0,lastCheckedAt:FieldValue.serverTimestamp(),lastSuccessAt:FieldValue.serverTimestamp(),lastResult:result,lastError:'',leaseUntil:0});
        tx.set(db.collection('scheduleSheetSyncRuns').doc(runId),{...result,sourceHash:hash,sourceSchemaVersion:SCHEDULE_SYNC_SCHEMA_VERSION,completedAt:FieldValue.serverTimestamp()});
      });
      console.info('scheduleSheetSyncResult',{runId,...result,issues:undefined});
      return result;
    } catch(error) {
      await db.runTransaction(async tx=>{const c=(await tx.get(control)).data();if(c?.runId===runId)tx.update(control,{lastError:String(error.message).slice(0,300),leaseUntil:0});});
      console.error('scheduleSheetSyncFailed',{runId,message:error.message});throw error;
    }
  }
  async function handle(input={}) {
    if(input.action==='setEnabled') {
      if(typeof input.enabled!=='boolean')throw Error('同步開關格式錯誤');
      await control.set({enabled:input.enabled,updatedAt:FieldValue.serverTimestamp()}, {merge:true});
    } else if(input.action==='preview') return summary(await preview(await readSource()));
    else if(input.action && input.action!=='status')throw Error('不支援的同步操作');
    const s=(await control.get()).data()||{};
    return {enabled:s.enabled===true,lastSuccessAt:s.lastSuccessAt?.toDate().toISOString()||null,lastError:s.lastError||'',lastResult:s.lastResult||null};
  }
  return {run,handle};
}
