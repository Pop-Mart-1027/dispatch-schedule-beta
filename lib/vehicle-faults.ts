import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export type FaultLane = 'employee' | 'monitor' | 'unrouted' | 'fleet'
export type FaultAccess = { employeeId: string; name: string; duty: boolean; fleet: boolean; admin: boolean }
export type FaultReport = {
  id: string; vehicleNo: string; faultType: string; description: string;
  reporterId: string; reporterName: string; createdAt: string | null; updatedAt: string | null;
  status: 'pending' | 'in_progress' | 'completed'; priority: 'unassessed' | 'normal' | 'priority' | 'urgent';
  version: number; unread: boolean; routingStatus: string; notificationStatus: string;
  assigneeId: string; assigneeName: string; monitorNote: string; completionNote: string;
  attachments: Array<{ index: number; mime: string; size: number }>;
}
export type FaultEvent = { id: string; action: string; actorName: string; note: string; createdAt: string | null }
export const faultTypes = ['動力／引擎', '煞車／輪胎', '燈號／電系', '車體／設備', '其他故障']
export const faultStatus = { pending: '待處理', in_progress: '處理中', completed: '已完成' }
export const faultPriority = { unassessed: '待監控判定', normal: '一般', priority: '優先', urgent: '緊急' }
export function vehicleFaultCall<T>(action: string, data: Record<string, unknown> = {}) {
  return httpsCallable<Record<string, unknown>, T>(functions, 'vehicleFault', { timeout: 120000 })({ ...data, action }).then(r => r.data)
}
export function faultError(reason: unknown) {
  const error = reason as { code?: string; message?: string }
  if (error?.code === 'functions/not-found') return '車輛通報服務尚未啟用，請稍後再試；不影響其他功能。'
  if (error?.code === 'functions/unauthenticated') return '登入已逾時，請重新登入。'
  if (error?.code === 'functions/permission-denied') return error.message || '沒有此操作權限。'
  if (error?.code && ['functions/invalid-argument', 'functions/failed-precondition', 'functions/aborted', 'functions/unavailable'].includes(error.code)) return error.message || '操作未完成，請重試。'
  return '目前無法完成操作，資料未確認送出。請保留內容後重試。'
}
export function mediaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('附件無法讀取'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}
