'use client'

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Gauge, Inbox, Plus, RefreshCw, Search, Trash2, Truck, X } from 'lucide-react'
import { listDispatchBlocks, listDispatchBlockTemplate } from '../lib/dispatch-blocks-firestore'
import { mileageCall, mileageError, mileageTime, mileageToday, mileageWeek, mileageWeekLabel, type MileageBoard, type MileageHistory, type MileageReport, type MileageRow } from '../lib/vehicle-mileage'
import './vehicle-mileage.css'

class MileageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className="vm-error" role="alert">里程畫面暫時無法顯示，請重新開啟；其他功能仍可使用。</p> : this.props.children }
}

export function VehicleMileageEmployee({ onBack }: { onBack: () => void }) {
  return <MileageBoundary><MileageEntry onBack={onBack} /></MileageBoundary>
}

function MileageEntry({ onBack }: { onBack: () => void }) {
  const [date, setDate] = useState(mileageToday)
  const [vehicleNo, setVehicleNo] = useState('')
  const [distance, setDistance] = useState('')
  const [reports, setReports] = useState<MileageReport[]>([])
  const [person, setPerson] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const week = mileageWeek(date)
  const plate = vehicleNo.trim().toUpperCase().replace(/\s/g, '').replace(/^([A-Z]{2,3})(\d{4})$/, '$1-$2')
  const existing = reports.find(r => r.vehicleNo === plate)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setNotice(''); setReports([])
    mileageCall<{ reports: MileageReport[]; name: string; employeeId: string }>('mine', { week }).then(result => {
      if (!cancelled) { setReports(result.reports); setPerson(`${result.name} · ${result.employeeId}`) }
    }).catch(e => { if (!cancelled) setError(mileageError(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [week])
  const submit = async () => {
    if (busy || loading || !vehicleNo.trim() || !/^\d+$/.test(distance)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await mileageCall('submit', { week, vehicleNo, mileage: Number(distance), version: existing?.version || 0 })
      setNotice('里程已儲存，已列入車管本週收件匣。')
      setDistance(''); setVehicleNo('')
      try { const result = await mileageCall<{ reports: MileageReport[] }>('mine', { week }); setReports(result.reports) }
      catch { setError('已儲存成功，但紀錄列表更新失敗；請重新開啟查看，不需重複送出。') }
    } catch (e) { setError(mileageError(e)) }
    finally { setBusy(false) }
  }
  return <section className="vm-module vm-entry">
    <button className="vm-back" onClick={onBack} disabled={busy}><ArrowLeft size={17} />工作總覽</button>
    <header className="vm-title"><span className="vm-title-icon"><Gauge /></span><div><p>每週五 · 車輛回報</p><h2>里程登記</h2><small>填寫儀表板目前累積公里數，不需上傳照片。</small></div></header>
    <form className="vm-entry-card" onSubmit={e => { e.preventDefault(); void submit() }}>
      <div className="vm-person"><span>登記人員</span><strong>{person || '正在確認登入身分…'}</strong></div>
      <label>登記週次<input type="date" value={date} max={mileageToday()} disabled={busy} onChange={e => { if (e.target.value) setDate(e.target.value) }} /><small>{mileageWeekLabel(date)} · 可選過去日期補登</small></label>
      <label>車號<input autoCapitalize="characters" autoComplete="off" placeholder="例如 RFW-7651" value={vehicleNo} maxLength={20} required disabled={busy} onChange={e => { setVehicleNo(e.target.value); setNotice('') }} /></label>
      <label>目前累積里程<div className="vm-distance"><input inputMode="numeric" pattern="[0-9]+" placeholder="例如 3500" value={distance} maxLength={7} required disabled={busy} onChange={e => setDistance(e.target.value)} /><span>公里</span></div></label>
      {existing && <p className="vm-note">你本週已登記 {existing.mileage.toLocaleString()} 公里。再次送出會更新這筆，並保留修改紀錄。</p>}
      {error && <p className="vm-error" role="alert">{error}</p>}{notice && <p className="vm-success" role="status"><Check size={18} />{notice}</p>}
      <button className="vm-primary vm-submit" disabled={loading || busy || !vehicleNo.trim() || !/^\d+$/.test(distance)}>{busy ? '正在儲存…' : existing ? '更新本週里程' : '送出里程'}</button>
    </form>
    <section className="vm-my-reports"><h3>我在這一週的登記</h3>{loading ? <p>載入中…</p> : reports.length === 0 ? <p className="vm-muted">尚無登記紀錄</p> : reports.map(r => <button key={r.id} disabled={busy} onClick={() => { setVehicleNo(r.vehicleNo); setDistance(String(r.mileage)); setNotice('') }}><Truck size={20} /><span><strong>{r.vehicleNo}</strong><small>{mileageTime(r.updatedAt)}</small></span><b>{r.mileage.toLocaleString()} <small>km</small></b></button>)}</section>
  </section>
}

export function VehicleMileageFleet({ faultInbox, onBack }: { faultInbox: ReactNode; onBack: () => void }) {
  const [tab, setTab] = useState<'mileage' | 'faults'>('mileage')
  return <MileageBoundary><div className="vm-module"><div className="vm-module-tabs"><button className={tab === 'mileage' ? 'active' : ''} onClick={() => setTab('mileage')}><Gauge size={18} />每週里程</button><button className={tab === 'faults' ? 'active' : ''} onClick={() => setTab('faults')}><Inbox size={18} />故障通報</button></div>{tab === 'mileage' ? <MileageBoardView onBack={onBack} /> : faultInbox}</div></MileageBoundary>
}

function MileageBoardView({ onBack }: { onBack: () => void }) {
  const [date, setDate] = useState(mileageToday)
  const [board, setBoard] = useState<MileageBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'missing' | 'received'>('all')
  const [inbox, setInbox] = useState(false)
  const [newPlate, setNewPlate] = useState('')
  const [detail, setDetail] = useState<MileageHistory | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editMileage, setEditMileage] = useState('')
  const [registry, setRegistry] = useState<Array<{ vehicleNo: string; active: boolean }>>([])
  const [managing, setManaging] = useState(false)
  const request = useRef(0)
  const detailRequest = useRef(0)
  const week = mileageWeek(date)
  const load = useCallback(async (initialize = false, quiet = false) => {
    const sequence = ++request.current
    if (!quiet) setLoading(true)
    setError('')
    try {
      if (initialize) {
        const reg = await mileageCall<{ initialized: boolean; vehicles: Array<{ vehicleNo: string; active: boolean }> }>('registry')
        if (!reg.initialized) {
          const today = mileageToday()
          const saved = await listDispatchBlocks(today)
          const blocks = saved.length ? saved : (await listDispatchBlockTemplate(today)).blocks
          const result = await mileageCall<{ rejected: string[] }>('initialize', { vehicleNos: blocks.map(b => b.vehicleNo) })
          if (sequence === request.current && result.rejected.length) setNotice(`部分派工車號無法辨識，請在車號管理核對：${result.rejected.join('、')}`)
        }
      }
      const [result, reg] = await Promise.all([mileageCall<MileageBoard>('board', { week }), mileageCall<{ vehicles: Array<{ vehicleNo: string; active: boolean }> }>('registry')])
      if (sequence === request.current) { setBoard(result); setRegistry(reg.vehicles) }
    } catch (e) { if (sequence === request.current) setError(mileageError(e)) }
    finally { if (sequence === request.current) setLoading(false) }
  }, [week])
  useEffect(() => {
    setBoard(null); setDetail(null); detailRequest.current += 1
    void load(true)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(false, true) }, 60000)
    return () => { request.current += 1; window.clearInterval(timer) }
  }, [load])
  const manage = async (action: 'vehicles.add' | 'vehicles.archive', vehicleNo: string) => {
    if (busy) return
    if (action === 'vehicles.archive' && !window.confirm(`從使用中清單移除 ${vehicleNo}？歷史里程保留，不會修改派工單。`)) return
    setBusy(true); setError('')
    try { await mileageCall(action, { vehicleNo }); setNewPlate(''); await load() }
    catch (e) { setError(mileageError(e)) }
    finally { setBusy(false) }
  }
  const open = async (row: MileageRow) => {
    if (!row.report) return
    const sequence = ++detailRequest.current
    setDetail(null); setDetailLoading(true); setError('')
    try {
      const result = await mileageCall<MileageHistory>('history', { week, vehicleNo: row.vehicleNo })
      if (sequence !== detailRequest.current) return
      setDetail(result); setEditMileage(String(result.report.mileage))
      await mileageCall('read', { week, vehicleNo: row.vehicleNo, version: result.report.version })
      if (sequence === detailRequest.current) await load(false, true)
    } catch (e) { if (sequence === detailRequest.current) setError(mileageError(e)) }
    finally { if (sequence === detailRequest.current) setDetailLoading(false) }
  }
  const update = async () => {
    if (!detail || busy || !/^\d+$/.test(editMileage)) return
    setBusy(true); setError('')
    try {
      await mileageCall('submit', { week, vehicleNo: detail.report.vehicleNo, mileage: Number(editMileage), version: detail.report.version })
      setDetail(null); await load(); setNotice('里程已修正，修改紀錄已保留。')
    } catch (e) { setError(mileageError(e)) }
    finally { setBusy(false) }
  }
  const rows = board?.rows || []
  const registered = rows.filter(r => r.report).length
  const unread = rows.filter(r => r.unread).length
  const visible = rows.filter(r => r.vehicleNo.includes(search.trim().toUpperCase()) && (inbox ? !!r.report : filter === 'all' || (filter === 'missing' ? !r.report : !!r.report)))
  return <section>
    <button className="vm-back" onClick={onBack}><ArrowLeft size={17} />後台總覽</button>
    <header className="vm-title"><span className="vm-title-icon"><Truck /></span><div><p>車管中心 · 每週五登記</p><h2>車輛里程看板</h2><small>一車一格，先看尚未回報的車輛。</small></div><button className="vm-secondary vm-refresh" disabled={busy || loading} onClick={() => void load(true)}><RefreshCw size={16} />重新整理</button></header>
    <div className="vm-board-toolbar"><label>週次<input type="date" value={date} max={mileageToday()} disabled={busy} onChange={e => { if (e.target.value) setDate(e.target.value) }} /></label><span className="vm-week">{mileageWeekLabel(date)}</span><button className="vm-secondary" onClick={() => setManaging(!managing)}><Plus size={16} />車號管理</button></div>
    {managing && <section className="vm-management"><h3>使用中車號</h3><p>首次由派工單帶入，之後在這裡新增／刪除；不回寫派工單。</p><form onSubmit={e => { e.preventDefault(); void manage('vehicles.add', newPlate) }}><input aria-label="新增車號" placeholder="輸入完整車號" value={newPlate} maxLength={20} autoCapitalize="characters" disabled={busy} onChange={e => setNewPlate(e.target.value)} /><button className="vm-primary" disabled={busy || !newPlate.trim()}>新增車輛</button></form><div className="vm-vehicle-list">{registry.filter(v => v.active).map(v => <span key={v.vehicleNo}>{v.vehicleNo}<button aria-label={`刪除 ${v.vehicleNo}`} disabled={busy} onClick={() => void manage('vehicles.archive', v.vehicleNo)}><Trash2 size={15} /></button></span>)}</div></section>}
    <div className="vm-summary"><span>本週車輛 <b>{rows.length}</b></span><span className="vm-red-text">未登記 <b>{rows.length - registered}</b></span><span className="vm-green-text">已登記 <b>{registered}</b></span><button className={inbox ? 'active' : ''} onClick={() => setInbox(!inbox)}><Inbox size={17} />{inbox ? '返回看板' : '里程收件匣'}{unread > 0 && <b>{unread}</b>}</button></div>
    <div className="vm-filters"><label className="vm-search"><Search size={16} /><input aria-label="搜尋車號" placeholder="搜尋車號" value={search} onChange={e => setSearch(e.target.value)} /></label>{!inbox && <div>{([['all', '全部'], ['missing', '未登記'], ['received', '已登記']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>}</div>
    {notice && <p className="vm-note" role="status">{notice}</p>}{error && <p className="vm-error" role="alert">{error}</p>}
    {loading && !board ? <p className="vm-empty">正在載入車號與里程…</p> : !board ? <p className="vm-empty">尚未載入看板。請重試，或開啟車號管理新增車輛。</p> : !visible.length ? <p className="vm-empty">{inbox ? '這一週尚無符合條件的回報。' : '沒有符合條件的車輛。'}</p> : <div className="vm-grid">{visible.map(row => <button className={`vm-vehicle ${row.report ? 'registered' : 'missing'}`} key={row.vehicleNo} disabled={!row.report} onClick={() => void open(row)}><div className="vm-vehicle-top"><Truck size={18} /><span>{row.report ? '已登記' : '未登記'}</span>{row.unread && <i>未讀</i>}</div><h3>{row.vehicleNo}</h3><div className="vm-odometer">{row.report ? row.report.mileage.toLocaleString() : '—'}<small>公里</small></div><footer>{row.report ? <><span>{row.report.reporterName} · {row.report.reporterId}</span><small>{mileageTime(row.report.updatedAt)}</small></> : <span>等待本週里程回報</span>}{!row.active && <small>已從使用中清單移除 · 歷史保留</small>}</footer></button>)}</div>}
    {(detail || detailLoading) && <div className="vm-overlay"><section className="vm-dialog" role="dialog" aria-modal="true" aria-label="里程登記詳情"><header><h3>{detail?.report.vehicleNo || '載入紀錄…'}</h3><button aria-label="關閉" disabled={busy} onClick={() => { detailRequest.current += 1; setDetail(null); setDetailLoading(false) }}><X /></button></header><div className="vm-dialog-body">{detail && <><p>{mileageWeekLabel(detail.report.week)}</p><p>登記人：{detail.report.reporterName} · {detail.report.reporterId}</p><label>核對後里程（公里）<input inputMode="numeric" value={editMileage} maxLength={7} disabled={busy} onChange={e => setEditMileage(e.target.value)} /></label><h4>修改紀錄</h4><ol className="vm-history">{detail.events.map(event => <li key={event.version}><strong>{event.mileage.toLocaleString()} 公里</strong><span>{event.actorName}</span><small>{mileageTime(event.createdAt)}{event.previousMileage !== null && ` · 原 ${event.previousMileage.toLocaleString()} 公里`}</small></li>)}</ol></>}{error && <p className="vm-error" role="alert">{error}</p>}</div><footer><button className="vm-secondary" disabled={busy} onClick={() => { detailRequest.current += 1; setDetail(null); setDetailLoading(false) }}>關閉</button><button className="vm-primary" disabled={busy || !detail || !/^\d+$/.test(editMileage)} onClick={() => void update()}>{busy ? '儲存中…' : '儲存修正'}</button></footer></section></div>}
  </section>
}
