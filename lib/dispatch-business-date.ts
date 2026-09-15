import type { DispatchShift } from './dispatch-shifts'

const DAY = 24 * 60 * 60 * 1000
const TAIPEI_OFFSET = 8 * 60 * 60 * 1000

export function isDispatchNightWindow(now = Date.now()): boolean {
  const hour = new Date(now + TAIPEI_OFFSET).getUTCHours()
  return hour >= 22 || hour < 8
}

// This is a dispatch viewing date, not a change to an employee's schedule.
export function dispatchBusinessDate(shift: DispatchShift, now = Date.now()): string {
  const local = new Date(now + TAIPEI_OFFSET)
  const previousDay = shift === '夜' && local.getUTCHours() < 8
  return new Date(local.getTime() - (previousDay ? DAY : 0)).toISOString().slice(0, 10)
}

export function initialDispatchShift(now = Date.now()): DispatchShift {
  return isDispatchNightWindow(now) ? '夜' : '早'
}
