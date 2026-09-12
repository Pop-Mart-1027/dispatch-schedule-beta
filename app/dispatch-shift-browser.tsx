'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { listScheduleRecords, type ScheduleRecord } from '../lib/schedule-firestore'
import { buildDispatchPreviewBlocks, listDispatchBlocks, listDispatchBlockTemplate, type DispatchBlock } from '../lib/dispatch-blocks-firestore'
import { buildShiftDispatchBlocks, type AssignmentEmployee } from '../lib/dispatch-schedule-assignment'
import { dispatchShifts, type DispatchShift } from '../lib/dispatch-shifts'
import { dispatchBlockFrontOrder } from '../lib/dispatch-area'
import { WorkFocus } from './work-focus'

// This view intentionally imports no writer, callable, editor or save handler.
export function DispatchShiftBrowser() {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [shift, setShift] = useState<DispatchShift>('早')
  const [blocks, setBlocks] = useState<DispatchBlock[]>([])
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [employees, setEmployees] = useState<AssignmentEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [preview, setPreview] = useState(false)
  const [area, setArea] = useState('')
  const [areaSearch, setAreaSearch] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setWarning(''); setBlocks([]); setSchedules([]); setEmployees([]); setPreview(false)
    const readBlocks = async () => {
      const saved = await listDispatchBlocks(date)
      return saved.length ? { blocks: saved, preview: false }
        : { blocks: buildDispatchPreviewBlocks((await listDispatchBlockTemplate(date)).blocks, date), preview: true }
    }
    void Promise.allSettled([readBlocks(), listScheduleRecords(date), getDocs(collection(db, 'employees'))]).then(([dispatch, roster, profiles]) => {
      if (cancelled) return
      if (dispatch.status === 'rejected' || roster.status === 'rejected') {
        console.error('[dispatchShiftBrowser] read failed', dispatch.status === 'rejected' ? dispatch.reason : roster.status === 'rejected' ? roster.reason : undefined)
        setError('派工或班表資料載入失敗，請重新選擇日期後再試。')
        return
      }
      setBlocks(dispatch.value.blocks); setPreview(dispatch.value.preview); setSchedules(roster.value)
      if (profiles.status === 'fulfilled') {
        setEmployees(profiles.value.docs.map(item => {
          const data = item.data()
          return { employeeId: data.employeeId || item.id, name: data.name || '', title: data.title || '' }
        }))
      } else {
        console.error('[dispatchShiftBrowser] employee read failed', profiles.reason)
        setWarning('員工補充資料載入失敗，目前依當日班表資料顯示。')
      }
    }).catch(reason => {
      if (!cancelled) { console.error('[dispatchShiftBrowser] load failed', reason); setError('派工資料載入失敗。') }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  const result = useMemo(() => {
    try { return { blocks: buildShiftDispatchBlocks({ date, blocks, schedules, employees }), error: '' } }
    catch (reason) { console.error('[dispatchShiftBrowser] grouping failed', reason); return { blocks: [], error: '派工資料格式異常，無法顯示。' } }
  }, [date, blocks, schedules, employees])
  const selected = result.blocks.filter(block => block.dispatchShift === shift)
  const areas = [...new Set(selected.map(block => block.areaCode || block.areaName || '特殊派工'))].sort()
  const visible = selected.filter(block => (!area || (block.areaCode || block.areaName || '特殊派工') === area)
    && `${block.areaCode || ''} ${block.areaName} ${block.vehicleNo}`.toLowerCase().includes(areaSearch.trim().toLowerCase())
    && (!employeeSearch.trim() || [...block.drivers, ...block.stations, ...block.assistants].some(person =>
      `${person.employeeId} ${person.employeeName}`.toLowerCase().includes(employeeSearch.trim().toLowerCase())))).sort(dispatchBlockFrontOrder)
  const names = (people: DispatchBlock['drivers']) => people.map(person => `${person.employeeName} ${person.employeeId}`).join('、') || '—'

  return <section aria-label="三班派工唯讀查閱">
    <div className="admin-page-toolbar filters">
      <label>日期<input type="date" value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setArea('') } }} /></label>
      <label>班別<select aria-label="班別" value={shift} onChange={event => { setShift(event.target.value as DispatchShift); setArea('') }}>{dispatchShifts.map(value => <option key={value} value={value}>{value}班</option>)}</select></label>
      <label>區域篩選<select value={area} onChange={event => setArea(event.target.value)}><option value="">全部區域</option>{areas.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>區域搜尋<input placeholder="區域或車號" value={areaSearch} onChange={event => setAreaSearch(event.target.value)} /></label>
      <label>員工搜尋<input placeholder="員編或姓名" value={employeeSearch} onChange={event => setEmployeeSearch(event.target.value)} /></label>
      {!loading && !error && !result.error && <strong>{visible.length} 個派工區塊</strong>}
    </div>
    <p className="admin-preview-note">三班派工目前僅供查閱，暫不提供分班編輯或儲存。</p>
    {preview && !loading && <p className="admin-preview-note">此日期尚無正式派工，以下為班表預覽，未寫入資料。</p>}
    {(error || result.error) && <p className="admin-alert" role="alert">{error || result.error}</p>}
    {warning && <p className="admin-alert" role="status">{warning}</p>}
    {loading ? <p role="status">派工資料載入中…</p> : !error && !result.error && <div className="admin-table-wrap"><table className="admin-data-table dispatch-table">
      <thead><tr><th>區域</th><th>車號</th><th>駕駛</th><th>駐點</th><th>隨車</th><th>工作重點</th></tr></thead>
      <tbody>{visible.map(block => <tr key={block.id} data-dispatch-shift={block.dispatchShift}><td><b>{block.areaName || block.areaCode || '特殊派工'}</b></td><td>{block.vehicleNo || '—'}</td><td>{names(block.drivers)}</td><td>{names(block.stations)}</td><td>{names(block.assistants)}</td><td className="focus-cell"><WorkFocus text={block.workFocus} collapsible /></td></tr>)}</tbody>
    </table>{!visible.length && <p>此日期、班別沒有符合條件的派工。</p>}</div>}
  </section>
}
