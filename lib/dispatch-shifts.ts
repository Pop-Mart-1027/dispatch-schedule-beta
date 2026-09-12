export const dispatchShifts = ['早', '晚', '夜'] as const
export type DispatchShift = typeof dispatchShifts[number]

// Daily cell content is authoritative; roster groups and employee profiles are not shifts.
export function parseDispatchShifts(value: string | null | undefined): DispatchShift[] {
  const shifts = new Set<DispatchShift>()
  for (const part of (value || '').split(/[／/＋+、，,；;＆&\n]/)) {
    const code = part.trim()
    if (!code || /國假|請假|病|事假|特休|公假|喪|婚假|陪|家庭照顧|慰/.test(code)
      || /^(?:早|晚|夜|小夜)?(?:休|例|假)$/.test(code)) continue
    if (code.includes('早')) shifts.add('早')
    if (code.includes('晚') || code.includes('小夜')) shifts.add('晚')
    if (code.includes('夜')) shifts.add('夜')
  }
  return dispatchShifts.filter(shift => shifts.has(shift))
}
