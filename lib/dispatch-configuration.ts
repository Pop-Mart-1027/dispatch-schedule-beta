import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { DispatchBlock, DispatchBlockEditable } from './dispatch-blocks-firestore'

export const dispatchSlot = (block: DispatchBlock) => block.blockId.replace(/^\d{4}-\d{2}-\d{2}_/, '')
export const dispatchToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export function followingDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate()+1)
  return value.toISOString().slice(0,10)
}
export type DispatchConfigurationBase = { activeFrom: string; blocks: DispatchBlock[] }
export type DispatchConfigurationVersion = {
  id: string; effectiveFrom: string; slot: string; values: DispatchBlockEditable;
  manualPeople: boolean; modifiedBy: string; createdAt?: {seconds?: number; nanoseconds?: number}
}
export function resolveDispatchConfiguration(date: string, persisted: DispatchBlock[], base: DispatchConfigurationBase | null, versions: DispatchConfigurationVersion[]) {
  if (!base || date < base.activeFrom) return persisted
  const existing = new Map(persisted.map(b=>[dispatchSlot(b),b]))
  const latest = new Map<string,DispatchConfigurationVersion>()
  const time = (v: DispatchConfigurationVersion) => (v.createdAt?.seconds||0)*1000+(v.createdAt?.nanoseconds||0)/1e6
  for(const version of [...versions].filter(v=>v.effectiveFrom<=date).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||time(a)-time(b)||a.id.localeCompare(b.id)))latest.set(version.slot,version)
  const merged = base.blocks.map(template=>{
    const slot=dispatchSlot(template), original=existing.get(slot)
    existing.delete(slot)
    if(original?.modifiedBy?.trim())return original
    const id=`${date}_${slot}`
    const block: DispatchBlock = original || {...template,id,blockId:id,date,drivers:[],stations:[],assistants:[],modifiedBy:'',modifiedAt:null,status:'preview'}
    const version=latest.get(slot)
    // A daily override must never become a future template. Structural defaults
    // come from the immutable base and effective version, not a nearby daily row.
    if(original && !version)return original
    const values=version?.values
    return {...block,areaName:values?.areaName ?? template.areaName,vehicleNo:values?.vehicleNo ?? template.vehicleNo,
      workFocus:values?.workFocus ?? template.workFocus,balanceArea:values?.balanceArea ?? template.balanceArea,note:values?.note ?? template.note,
      ...(version?.manualPeople ? {drivers:values!.drivers,stations:values!.stations,assistants:values!.assistants,
        modifiedBy:version.modifiedBy,modifiedAt:version.createdAt,configurationPeople:true} : {})}
  })
  return [...merged,...existing.values()]
}

export async function readDispatchConfigurationBase(database=db) {
  const snapshot=await getDoc(doc(database,'dispatchConfiguration','base'))
  return snapshot.exists()?snapshot.data() as DispatchConfigurationBase:null
}
export async function configuredDispatchBlocks(date: string, persisted: DispatchBlock[], database=db, baseSnapshot?: DispatchConfigurationBase | null) {
  const base=baseSnapshot === undefined ? await readDispatchConfigurationBase(database) : baseSnapshot
  if(!base)return persisted
  if(date<base.activeFrom)return persisted
  const versions=await getDocs(query(collection(database,'dispatchConfigurationVersions'),where('effectiveFrom','<=',date)))
  return resolveDispatchConfiguration(date,persisted,base,versions.docs.map(d=>({id:d.id,...d.data()} as DispatchConfigurationVersion)))
}

export async function saveDispatchConfiguration(input: {block:DispatchBlock; values:DispatchBlockEditable; blocks:DispatchBlock[]; mode:'day'|'version'; employeeId:string},database=db) {
  const {block,values,mode,employeeId}=input
  if(mode==='version'&&block.date<dispatchToday())throw Error('新版配置請選擇今天或未來日期，避免影響歷史日期。')
  if(!values.areaName.trim())throw Error('請填寫區域名稱')
  let baselineBlocks=input.blocks
  // Editing an old date must not turn that historical configuration into the
  // standard for today's previews. Capture the latest available current source.
  if(block.date<dispatchToday()){
    const snapshot=await getDocs(query(collection(database,'dispatchBlocks'),orderBy('date','desc'),limit(500)))
    const rows=snapshot.docs.map(d=>({id:d.id,...d.data()} as DispatchBlock)).filter(b=>b.date<=dispatchToday()&&b.status!=='deleted')
    const date=rows.map(b=>b.date).sort().at(-1)
    if(date)baselineBlocks=rows.filter(b=>b.date===date)
  }
  const baseRef=doc(database,'dispatchConfiguration','base'),target=doc(database,'dispatchBlocks',block.id)
  const audit=doc(collection(database,'dispatchAuditLogs')),version=doc(collection(database,'dispatchConfigurationVersions'))
  await runTransaction(database,async tx=>{
    const [base,current]=await Promise.all([tx.get(baseRef),tx.get(target)])
    // Reject concurrent daily edits, including a daily override created while
    // this editor was open on a derived preview.
    if(current.exists()){
      const raw=current.data()
      if(raw.modifiedBy && (JSON.stringify(raw.modifiedAt)!==JSON.stringify(block.modifiedAt)||raw.modifiedBy!==block.modifiedBy))throw Error('派工已被其他人修改，請重新載入後再試。')
    }
    const timestamp=serverTimestamp()
    if(!base.exists())tx.set(baseRef,{activeFrom:dispatchToday(),blocks:baselineBlocks.map(b=>({
      id:b.id,blockId:b.blockId,date:b.date,shiftType:b.shiftType,areaCode:b.areaCode,areaName:b.areaName,variantCode:b.variantCode,
      vehicleNo:b.vehicleNo,vehicleType:b.vehicleType,workFocus:b.workFocus,balanceArea:b.balanceArea,note:b.note,
      sourceSheet:b.sourceSheet,sourceRow:b.sourceRow,status:'active',drivers:[],stations:[],assistants:[],modifiedBy:'',modifiedAt:null,
    })),createdAt:timestamp,modifiedBy:employeeId})
    const day={date:block.date,shiftType:block.shiftType,blockId:block.blockId,areaCode:block.areaCode,
      variantCode:block.variantCode,vehicleType:block.vehicleType,sourceSheet:block.sourceSheet,
      sourceRow:block.sourceRow,sourceUpdatedAt:null,status:'active',createdAt:current.data()?.createdAt||timestamp,
      ...values,modifiedBy:employeeId,modifiedAt:timestamp,updatedAt:timestamp}
    tx.set(target,day,{merge:true})
    const before={areaName:block.areaName,vehicleNo:block.vehicleNo,drivers:block.drivers,stations:block.stations,assistants:block.assistants,workFocus:block.workFocus,balanceArea:block.balanceArea,note:block.note}
    const effectiveFrom=followingDate(block.date)
    if(mode==='version')tx.set(version,{effectiveFrom,slot:dispatchSlot(block),values,
      manualPeople:!!block.modifiedBy||['drivers','stations','assistants'].some(field=>JSON.stringify(values[field as keyof DispatchBlockEditable])!==JSON.stringify(before[field as keyof DispatchBlockEditable])),
      modifiedBy:employeeId,createdAt:timestamp,auditId:audit.id})
    tx.set(audit,{recordType:'dispatchBlock',recordId:block.id,blockId:block.blockId,date:block.date,before,after:values,
      mode,effectiveFrom:mode==='version'?effectiveFrom:null,versionId:mode==='version'?version.id:null,modifiedBy:employeeId,createdAt:timestamp})
  })
}
