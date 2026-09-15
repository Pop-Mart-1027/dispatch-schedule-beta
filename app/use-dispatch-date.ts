'use client'

import { useCallback, useEffect, useState } from 'react'
import { dispatchBusinessDate, initialDispatchShift, isDispatchNightWindow } from '../lib/dispatch-business-date'
import type { DispatchShift } from '../lib/dispatch-shifts'

export function useDispatchDate() {
  const [now, setNow] = useState(Date.now)
  const [shift, updateShift] = useState<DispatchShift>(() => initialDispatchShift(now))
  const [manualDate, setManualDate] = useState<string | null>(null)
  const [shiftSelected, setShiftSelected] = useState(false)

  useEffect(() => {
    const refresh = () => setNow(Date.now())
    // Refresh at minute boundaries, including 08:00, and after a suspended PWA resumes.
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      refresh()
      timer = setTimeout(tick, 60000 - Date.now() % 60000)
    }
    tick()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const setDate = useCallback((value: string) => {
    setManualDate(value)
    setShiftSelected(true)
  }, [])
  const setShift = useCallback((value: DispatchShift) => {
    setNow(Date.now())
    updateShift(value)
    setShiftSelected(true)
  }, [])

  return {
    date: manualDate ?? dispatchBusinessDate(shift, now),
    shift,
    setDate,
    setShift,
    // Never let automatic personal-card positioning replace the overnight view
    // or override a tab/date that the user explicitly selected.
    allowAutoShift: !shiftSelected && !isDispatchNightWindow(now),
  }
}
