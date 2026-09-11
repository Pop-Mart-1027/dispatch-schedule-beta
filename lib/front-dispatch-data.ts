import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'
import type { DispatchBlock } from './dispatch-blocks-firestore'
import type { ScheduleRecord } from './schedule-firestore'

export type FrontDispatchProfile = { employeeId: string; name: string; title?: string; group?: string; area?: string }
// Only exact, unambiguous whole-cell leave codes excluded by BOTH the existing
// assignment parser and duty panel. Compound/unknown/empty codes remain eligible.
const wholeDayLeave = new Set(['例', '休', '慰', '病', '病假', '事', '事假', '特休', '假'])
export function frontDispatchProfileIds(records: ScheduleRecord[]) {
  return [...new Set(records.filter(record => !wholeDayLeave.has(record.scheduleCode)).map(record => record.employeeId).filter(Boolean))]
}
export async function loadFrontDispatchProfiles(records: ScheduleRecord[], database = db): Promise<FrontDispatchProfile[]> {
  const ids = frontDispatchProfileIds(records)
  const batches = Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => ids.slice(i * 30, i * 30 + 30))
  const snapshots = await Promise.all(batches.map(batch => getDocs(query(collection(database, 'employees'), where(documentId(), 'in', batch)))))
  return snapshots.flatMap(snapshot => snapshot.docs.map(item => ({ employeeId: item.id, ...item.data() } as FrontDispatchProfile)))
}

type Snapshot = { blocks: DispatchBlock[]; schedules: ScheduleRecord[]; profiles: FrontDispatchProfile[]; isPreview: boolean }
const snapshots = new Map<string, { value: Snapshot; savedAt: number }>()
const ttl = 30_000
export function readFrontDispatchCache(employeeId: string, date: string, now = Date.now()) {
  const key = employeeId + ':' + date, cached = snapshots.get(key)
  if (!cached || now - cached.savedAt >= ttl) { snapshots.delete(key); return null }
  return cached.value
}
export function saveFrontDispatchCache(employeeId: string, date: string, value: Snapshot, now = Date.now()) {
  const key = employeeId + ':' + date
  snapshots.delete(key); snapshots.set(key, { value, savedAt: now })
  while (snapshots.size > 3) snapshots.delete(snapshots.keys().next().value!)
}
export function clearFrontDispatchCache() { snapshots.clear() }
export function markFrontDispatch(stage: string) {
  if (typeof performance === 'undefined') return
  if (stage === 'enter') for (const entry of performance.getEntriesByType('mark')) {
    if (entry.name.startsWith('smilebike:dispatch:') && entry.name !== 'smilebike:dispatch:login-profile-ready') performance.clearMarks(entry.name)
  }
  const name = 'smilebike:dispatch:' + stage
  if (['personal-painted', 'full-painted'].includes(stage) && performance.getEntriesByName(name).length) return
  performance.clearMarks(name); performance.mark(name)
}
