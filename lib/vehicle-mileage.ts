import { vehicleFaultCall } from './vehicle-faults'

export type MileageReport = { id: string; vehicleNo: string; week: string; mileage: number; reporterId: string; reporterName: string; version: number; createdAt: string | null; updatedAt: string | null }
export type MileageRow = { vehicleNo: string; active: boolean; report: MileageReport | null; unread: boolean }
export type MileageBoard = { week: string; initialized: boolean; rows: MileageRow[] }
export type MileageHistory = { report: MileageReport; events: Array<{ version: number; mileage: number; previousMileage: number | null; actorName: string; createdAt: string | null }> }
export const mileageCall = <T,>(action: string, data: Record<string, unknown> = {}) => vehicleFaultCall<T>(`mileage.${action}`, data)
export const mileageToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
export function mileageWeek(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
}
export function mileageWeekLabel(date: string) {
  const start = mileageWeek(date)
  const day = (n: number) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 86400000).toISOString().slice(5, 10).replace('-', '/')
  return `${start.slice(0, 4)} · ${day(0)}–${day(6)}（週五 ${day(4)}）`
}
export const mileageTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—'
export function mileageError(reason: unknown) {
  const error = reason as { code?: string; message?: string }
  return error.code?.startsWith('functions/') && !['functions/internal', 'functions/unknown'].includes(error.code) ? error.message || '操作未完成，請重試' : '里程服務暫時無法連線，請稍後重試；未確認儲存成功。'
}
