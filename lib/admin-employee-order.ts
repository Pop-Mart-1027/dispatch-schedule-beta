export type AdminEmployeeLike = {
  employeeId: string
  title?: string
}

export const ADMIN_TITLE_OPTIONS = [
  '調度主任',
  '調度副主任',
  '調度領班',
  '調度監控',
  '調度專員',
  '調度專員-E',
  '調度專員-N',
  '實習領班',
  '實習領班-N',
  'PT-早',
  'PT-晚',
  'PT-夜',
  'PT-早晚',
  'PT-晚夜',
  '實習生',
] as const

const titleRanks = new Map<string, number>(ADMIN_TITLE_OPTIONS.map((title, index) => [title, index]))

export function employeeTitleRank(title = '') {
  return titleRanks.get(title.trim()) ?? ADMIN_TITLE_OPTIONS.length
}

export function employeeAdminOrder<T extends AdminEmployeeLike>(left: T, right: T) {
  return employeeTitleRank(left.title) - employeeTitleRank(right.title)
    || left.employeeId.localeCompare(right.employeeId, 'en', { numeric: true, sensitivity: 'base' })
}

export function titleAdminOrder(left: string, right: string) {
  return employeeTitleRank(left) - employeeTitleRank(right)
    || left.localeCompare(right, 'zh-TW', { numeric: true })
}

export function isStandardAdminTitle(title = '') {
  return titleRanks.has(title.trim())
}

export function permissionLabel(role: string) {
  if (role === 'admin') return '管理員'
  if (role === 'duty' || role === 'monitor') return '值班監控'
  return '一般員工'
}
