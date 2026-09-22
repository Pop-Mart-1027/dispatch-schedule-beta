import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from './firebase'
import type { ScheduleRecord } from './schedule-firestore'
import type { MonthLayout } from './month-schedule-layout'
import { eligibleMonthSchedules } from '../functions/month-schedule-policy.mjs'

export type ScheduleProfile = { employeeId: string; name: string; title?: string; group?: string; area?: string; [key: string]: unknown }
export function subscribeMonthSchedule(month: string, onData: (records: ScheduleRecord[], people: ScheduleProfile[], layout: MonthLayout|null) => void, onError: (error: Error) => void) {
  let records: ScheduleRecord[]|undefined, people: ScheduleProfile[]|undefined, layout: MonthLayout|null|undefined, active=true
  let timer: ReturnType<typeof setTimeout>|undefined
  const emit=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(active && records && people && layout!==undefined)onData(eligibleMonthSchedules(records,layout) as ScheduleRecord[],people,layout)},150)}
  const fail=(error:Error)=>{if(active)onError(error)}
  const stops=[
    onSnapshot(query(collection(db,'scheduleRecords'),where('date','>=',`${month}-01`),where('date','<=',`${month}-31`)),s=>{records=s.docs.map(d=>({...d.data(),id:d.id} as ScheduleRecord));emit()},fail),
    onSnapshot(collection(db,'employees'),s=>{people=s.docs.map(d=>({...d.data(),employeeId:d.id} as ScheduleProfile));emit()},fail),
    onSnapshot(doc(db,'scheduleMonthLayouts',month),s=>{layout=s.exists()?s.data() as MonthLayout:null;emit()},fail),
  ]
  return ()=>{active=false;clearTimeout(timer);stops.forEach(stop=>stop())}
}
