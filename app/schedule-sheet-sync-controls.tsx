'use client'
import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
type SyncStatus={enabled:boolean;lastSuccessAt:string|null;lastError:string;lastResult:{changed:number;issueCount:number}|null}
export function ScheduleSheetSyncControls(){
  const [status,setStatus]=useState<SyncStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const call=async(input:object)=>{const r=await httpsCallable<object,SyncStatus>(functions,'manageGoogleScheduleSync')(input);setStatus(r.data)}
  useEffect(()=>{let alive=true;const load=()=>{void httpsCallable<object,SyncStatus>(functions,'manageGoogleScheduleSync')({action:'status'}).then(r=>{if(alive)setStatus(r.data)}).catch(()=>{if(alive)setError('試算表同步狀態暫時無法讀取')})};load();const timer=setInterval(load,60000);return()=>{alive=false;clearInterval(timer)}},[])
  const toggle=async()=>{if(!status)return;setBusy(true);setError('');try{await call({action:'setEnabled',enabled:!status.enabled})}catch{setError('變更同步設定失敗')}finally{setBusy(false)}}
  return <span className="admin-role-note">試算表同步：{status?(status.enabled?'開啟，每分鐘檢查':'已暫停'):'讀取中'} {status&&<button disabled={busy} onClick={()=>void toggle()}>{status.enabled?'暫停同步':'啟用同步'}</button>}{status?.lastSuccessAt&&<small> 最近成功：{new Date(status.lastSuccessAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}</small>}{(error||status?.lastError)&&<span role="alert">{error||status?.lastError}</span>}{!!status?.lastResult?.issueCount&&<small> 待核對 {status.lastResult.issueCount} 筆</small>}</span>
}
