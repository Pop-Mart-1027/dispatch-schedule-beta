import { collection, doc, getDoc, getDocs, orderBy, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'

export type Broadcast = { push?: { status: string; sendAt?: unknown; accepted?: number; failed?: number }; id: string; title: string; content: string; type: '一般' | '提醒' | '重要'; targetType: 'all' | 'morning' | 'night' | 'area' | 'employee'; targetValues: string[]; startAt: unknown; endAt: unknown; popupMode: 'once' | 'daily' | 'always' | 'none'; active: boolean; imageUrl: string; linkUrl: string; createdBy: string; createdAt?: unknown; updatedAt?: unknown }
export type BroadcastRead = { broadcastId: string; employeeId: string; firstShownAt?: unknown; lastShownAt?: unknown; readAt?: unknown; shownCount: number }

export async function listActiveBroadcasts() {
  const snapshot = await getDocs(query(collection(db, 'broadcasts'), where('active', '==', true), orderBy('startAt', 'desc')))
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Broadcast))
}
export async function listBroadcastReads(employeeId: string) {
  const snapshot = await getDocs(query(collection(db, 'broadcastReads'), where('employeeId', '==', employeeId)))
  return snapshot.docs.map(item => item.data() as BroadcastRead)
}
export async function getBroadcastRead(broadcastId: string, employeeId: string) {
  const snapshot = await getDoc(doc(db, 'broadcastReads', `${broadcastId}_${employeeId}`))
  return snapshot.exists() ? snapshot.data() as BroadcastRead : undefined
}
export async function recordBroadcastShown(read: BroadcastRead) {
  const readRef = doc(db, 'broadcastReads', `${read.broadcastId}_${read.employeeId}`)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(readRef)
    const previous = snapshot.exists() ? snapshot.data() as BroadcastRead : null
    transaction.set(readRef, {
      broadcastId: read.broadcastId,
      employeeId: read.employeeId,
      firstShownAt: previous?.firstShownAt || serverTimestamp(),
      lastShownAt: serverTimestamp(),
      readAt: serverTimestamp(),
      shownCount: (previous?.shownCount || 0) + 1,
    }, { merge: true })
  })
}
