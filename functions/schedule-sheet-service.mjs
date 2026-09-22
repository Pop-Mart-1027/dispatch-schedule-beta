import { randomUUID } from 'node:crypto';
import { SPREADSHEET_ID, discoverSheets, parseScheduleSheet, planScheduleSync, digest } from './schedule-sheet-domain.mjs';

export function createScheduleSheetSync({db,FieldValue,fetch:fetchSource=fetch}) {
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
    return source;
  };
  const preview=async source=>{
    const [people,records,layouts]=await Promise.all([
      db.collection('employees').get(),
      db.collection('scheduleRecords').where('date','>=','2026-09-01').get(),
      db.collection('scheduleMonthLayouts').get(),
    ]);
    return planScheduleSync({source,employees:people.docs.map(d=>({...d.data(),employeeId:d.id})),records:records.docs.map(d=>({...d.data(),id:d.id})),layouts:layouts.docs.map(d=>({...d.data(),id:d.id}))});
  };
  const summary=plan=>({changed:plan.updates.length,layouts:plan.layoutChanges.length,cleared:plan.cleared,issues:plan.issues.slice(0,100),issueCount:plan.issues.length});
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
      if(state.sourceHash===hash) {
        await control.update({lastCheckedAt:FieldValue.serverTimestamp(),leaseUntil:0});return {unchanged:true};
      }
      const plan=await preview(source);
      // Fail closed on bulk clearing; an administrator must inspect the source first.
      if(plan.cleared>100)throw Error(`來源將清空 ${plan.cleared} 格，已停止自動套用，請管理員核對`);
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
            const after={...task.after,updatedAt:FieldValue.serverTimestamp(),modifiedBy:'google-schedule-sync'};
            delete after.id;
            if(task.collection==='scheduleMonthLayouts')after.revision=(before?.revision||0)+1;
            if(!before)after.createdAt=FieldValue.serverTimestamp();
            tx.set(refs[i],after,{merge:true});
            tx.set(db.collection('scheduleSheetSyncRuns').doc(runId).collection('changes').doc(`${task.collection}_${task.id}`),{path:refs[i].path,before,after:task.after,createdAt:FieldValue.serverTimestamp()});
          }
          tx.update(control,{leaseUntil:Date.now()+480000});
        });
      }
      const result=summary(plan);
      await db.runTransaction(async tx=>{
        const c=(await tx.get(control)).data();if(c?.runId!==runId)return;
        tx.update(control,{sourceHash:hash,lastCheckedAt:FieldValue.serverTimestamp(),lastSuccessAt:FieldValue.serverTimestamp(),lastResult:result,lastError:'',leaseUntil:0});
        tx.set(db.collection('scheduleSheetSyncRuns').doc(runId),{...result,sourceHash:hash,completedAt:FieldValue.serverTimestamp()});
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
