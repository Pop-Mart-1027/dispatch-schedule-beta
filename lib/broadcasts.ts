import { collection, addDoc, getDocs, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'

export type Broadcast = { id: string; title: string; content: string; type: '一般' | '提醒' | '重要'; targetType: 'all' | 'morning' | 'night' | 'area' | 'employee'; targetValues: string[]; startAt: unknown; endAt: unknown; popupMode: 'once' | 'daily' | 'always' | 'none'; active: boolean; imageUrl: string; linkUrl: string; createdBy: string; createdAt?: unknown; updatedAt?: unknown }
export type BroadcastRead = { broadcastId: string; employeeId: string; firstShownAt?: unknown; lastShownAt?: unknown; readAt?: unknown; shownCount: number }

export async function listActiveBroadcasts() {
  const snapshot = await getDocs(query(collection(db, 'broadcasts'), where('active', '==', true), orderBy('startAt', 'desc')))
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Broadcast))
}
export async function listBroadcastReads(employeeId: string) {
  const snapshot = await getDocs(query(collection(db, 'broadcastReads'), where('employeeId', '==', employeeId)))
  return snapshot.docs.map(item => item.data() as BroadcastRead)
}
export async function recordBroadcastShown(read: BroadcastRead) {
  await addDoc(collection(db, 'broadcastReads'), { ...read, lastShownAt: serverTimestamp(), shownCount: (read.shownCount || 0) + 1 })
}
