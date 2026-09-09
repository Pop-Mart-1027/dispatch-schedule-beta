export const popupModeLabels: Record<string, string> = {
  once: '只顯示一次', daily: '每天一次', always: '每次開啟', none: '僅在列表顯示',
}
export const variantLabels: Record<string, string> = {
  standard: '一般派工', 'small-night': '小夜派工', Z: '支援派工',
}
export const targetTypeLabels: Record<string, string> = { all: '全體', morning: '早班', night: '夜班', area: '指定區域', employee: '指定員工' }
const auditLabels: Record<string, string> = {
  areaCode: '區域代碼', areaName: '區域名稱', variantCode: '派工類型', vehicleNo: '車號', vehicleType: '車型',
  drivers: '駕駛', stations: '駐點', assistants: '隨車', workFocus: '工作重點', balanceArea: '平衡區域', note: '備註',
  employeeId: '員編', employeeName: '姓名', name: '姓名', title: '職稱', sourceText: '來源文字', sourceRow: '來源列號',
  status: '狀態', date: '日期', shiftType: '班別', modifiedBy: '修改人', modifiedAt: '修改時間',
  scheduleCode: '班表代碼', scheduleLabel: '班別', leaveType: '假別', blockId: '派工編號', sourceSheet: '來源分頁',
}
export function readableAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(readableAudit)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item], index) => [auditLabels[key] || `其他資訊${index + 1}`, readableAudit(item)]))
  if (typeof value === 'string') return ({ active: '啟用', deleted: '已移除', stale: '已更新', preview: '預覽', morning: '早班', day: '日班', night: '夜班', ...variantLabels } as Record<string, string>)[value] || value
  return value
}
