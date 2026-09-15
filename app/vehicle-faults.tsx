'use client'

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Clock3, FileImage, Inbox, LoaderCircle, MessageSquareText, Paperclip, Plus, RefreshCw, Send, ShieldCheck, Truck, Wrench, X } from 'lucide-react'
import { faultError, faultPriority, faultStatus, faultTypes, mediaBase64, vehicleFaultCall, type FaultAccess, type FaultEvent, type FaultLane, type FaultReport } from '../lib/vehicle-faults'
import './vehicle-faults.css'

class FaultBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="vf-error" role="alert">車輛通報畫面暫時無法顯示，請切換頁面後重試。其他功能仍可正常使用。</div> : this.props.children }
}

function time(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '時間待同步'
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}
function ErrorMessage({ message }: { message: string }) { return message ? <div className="vf-error" role="alert"><AlertTriangle size={17} /><span>{message}</span></div> : null }
function Badge({ report }: { report: FaultReport }) { return <span className={`vf-badge vf-${report.status}`}>{faultStatus[report.status]}</span> }

export function VehicleFaultEmployee({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  return <FaultBoundary key={employeeId}><EmployeeReports employeeId={employeeId} employeeName={employeeName} /></FaultBoundary>
}
export function VehicleFaultBackend({ mode, onBack }: { mode: 'monitor' | 'fleet'; onBack?: () => void }) {
  return <div className="vf-backend">{onBack && <button className="vf-back" onClick={onBack}><ArrowLeft size={17} />返回後台選單</button>}<FaultBoundary key={mode}><ReportInbox mode={mode} /></FaultBoundary></div>
}

function EmployeeReports({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [tab, setTab] = useState<'new' | 'records'>('new')
  const [notice, setNotice] = useState('')
  return <section className="vf-module vf-employee">
    <header className="vf-heading"><div><span className="vf-kicker">車輛故障通報</span><h1>把問題交給我們處理</h1><p>通報當班監控，並送進車管收件匣。夜間通報也會保留。</p></div><span className="vf-hero-icon"><Wrench size={30} /></span></header>
    <nav className="vf-tabs" aria-label="通報功能"><button className={tab === 'new' ? 'is-active' : ''} onClick={() => setTab('new')}><Plus size={17} />新增通報</button><button className={tab === 'records' ? 'is-active' : ''} onClick={() => setTab('records')}><Clock3 size={17} />我的通報</button></nav>
    {notice && <div className="vf-success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="關閉提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {/* Keep the form mounted when checking previous cases, preserving its draft. */}
    <div hidden={tab !== 'new'}><FaultForm employeeId={employeeId} employeeName={employeeName} onSent={routingStatus => { setNotice(routingStatus === 'resolved' ? '通報已保存，已送進車管收件匣，當班監控通知正在處理。' : '通報已保存並送進車管收件匣；目前未找到可確認的當班監控，後台會顯示待確認通知對象。'); setTab('records') }} /></div>
    {tab === 'records' && <ReportInbox mode="employee" />}
  </section>
}

function FaultForm({ employeeId, employeeName, onSent }: { employeeId: string; employeeName: string; onSent: (routingStatus: string) => void }) {
  const [vehicleNo, setVehicleNo] = useState('')
  const [faultType, setFaultType] = useState(faultTypes[0])
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef('')
  const submitting = useRef(false)
  const changed = () => { requestId.current = ''; setError('') }
  function selectFiles(selected: FileList | null) {
    if (!selected) return
    const next = [...files, ...Array.from(selected)]
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
    if (next.length > 5 || next.some(f => !allowed.includes(f.type) || f.size === 0 || f.size > 6 * 1024 * 1024)) {
      setError('最多 5 個附件，每個不超過 6 MB。照片請用 JPG／PNG／WebP；影片請用 MP4／MOV／WebM。')
      return
    }
    changed(); setFiles(next)
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError(''); setProgress('正在保存通報…')
    if (!requestId.current) requestId.current = crypto.randomUUID()
    try {
      const draft = await vehicleFaultCall<{ draftId: string; reportId: string; published: boolean }>('draft', { requestId: requestId.current, vehicleNo, faultType, description, attachmentCount: files.length })
      if (!draft.published) {
        for (let index = 0; index < files.length; index++) {
          setProgress(`正在上傳附件 ${index + 1} / ${files.length}…`)
          await vehicleFaultCall('upload', { draftId: draft.draftId, index, mime: files[index].type, base64: await mediaBase64(files[index]) })
        }
      }
      setProgress('正在送出通報…')
      const result = await vehicleFaultCall<{ routingStatus: string }>('publish', { draftId: draft.draftId })
      setVehicleNo(''); setDescription(''); setFiles([]); requestId.current = ''; onSent(result.routingStatus)
    } catch (reason) { setError(faultError(reason)) }
    finally { submitting.current = false; setBusy(false); setProgress('') }
  }
  return <form className="vf-form" onSubmit={event => void submit(event)}>
    <div className="vf-form-main"><div className="vf-reporter"><span className="vf-avatar">{employeeName.slice(-2)}</span><div><small>通報人員 · 由登入帳號帶入</small><strong>{employeeName}<span>{employeeId}</span></strong></div><ShieldCheck size={19} /></div>
      <fieldset disabled={busy}><div className="vf-field-row"><label>車牌號碼<span className="vf-required">必填</span><input value={vehicleNo} maxLength={20} required placeholder="例如 RFW-7651" autoCapitalize="characters" onChange={e => { changed(); setVehicleNo(e.target.value.toUpperCase()) }} /></label><label>故障類型<select value={faultType} onChange={e => { changed(); setFaultType(e.target.value) }}>{faultTypes.map(t => <option key={t}>{t}</option>)}</select></label></div>
        <label>故障描述<span className="vf-required">必填</span><textarea required maxLength={2000} rows={5} value={description} placeholder="發生什麼狀況？例如煞車有異音、儀表亮警示燈。請盡量描述現象。" onChange={e => { changed(); setDescription(e.target.value) }} /><small className="vf-counter">{description.length} / 2000</small></label>
        <label className="vf-upload"><Paperclip size={23} /><strong>加入照片或影片</strong><span>拍攝或從裝置選取 · 選填 · 最多 5 個</span><small>每個上限 6 MB，影片建議使用短片。</small><input aria-label="選擇照片或影片" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple onChange={e => { selectFiles(e.target.files); e.target.value = '' }} /></label>
        {files.length > 0 && <ul className="vf-file-list">{files.map((file, i) => <li key={`${file.name}-${i}`}><FileImage size={18} /><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span><button type="button" aria-label={`移除附件 ${i + 1}`} onClick={() => { changed(); setFiles(files.filter((_, index) => i !== index)) }}><X size={17} /></button></li>)}</ul>}
      </fieldset>
      <ErrorMessage message={error} />
      <footer className="vf-form-footer"><span>確認內容後送出，進度可在「我的通報」查看。</span><button className="vf-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="vf-spin" size={18} /> : <Send size={18} />}{busy ? progress : '送出通報'}</button></footer>
    </div>
    <aside className="vf-guide"><span className="vf-kicker">後續如何處理</span><ol><li><b>01</b><div><strong>當班監控確認</strong><p>由監控判斷緊急程度與現場處置。</p></div></li><li><b>02</b><div><strong>車管收件</strong><p>案件留在 App 收件匣，不因換班或已讀消失。</p></div></li><li><b>03</b><div><strong>追蹤維修結果</strong><p>車管接手、處理、完成後，這裡都看得到。</p></div></li></ol><p className="vf-safety"><AlertTriangle size={18} />若有立即行車危險，請先停止使用車輛，並依公司緊急流程聯絡值班監控。</p></aside>
  </form>
}

function ReportInbox({ mode }: { mode: 'employee' | 'monitor' | 'fleet' }) {
  const [access, setAccess] = useState<FaultAccess | null>(null)
  const [reports, setReports] = useState<FaultReport[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [unrouted, setUnrouted] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const generation = useRef(0)
  const lane: FaultLane = mode === 'monitor' && unrouted ? 'unrouted' : mode
  const load = useCallback(async (after?: string) => {
    const current = ++generation.current
    setLoading(true); setError('')
    try {
      const capabilities = await vehicleFaultCall<FaultAccess>('capabilities')
      if (current !== generation.current) return
      setAccess(capabilities)
      const response = await vehicleFaultCall<{ reports: FaultReport[]; cursor: string | null }>('list', { lane, cursor: after })
      if (current !== generation.current) return
      setReports(old => after ? [...old, ...response.reports.filter(r => !old.some(o => o.id === r.id))] : response.reports)
      setCursor(response.cursor)
    } catch (reason) { if (current === generation.current) setError(faultError(reason)) }
    finally { if (current === generation.current) setLoading(false) }
  }, [lane])
  useEffect(() => { setReports([]); setSelected(null); void load(); return () => { generation.current++ } }, [load])
  const visible = reports.filter(r => (!search || `${r.vehicleNo} ${r.reporterId} ${r.reporterName}`.toLowerCase().includes(search.toLowerCase())) && (filter === 'all' || (filter === 'unread' ? r.unread : r.status === filter)))
  const unread = reports.filter(r => r.unread).length
  return <section className={`vf-module vf-inbox ${selected ? 'vf-has-selection' : ''}`}>
    {mode !== 'employee' && <header className="vf-heading"><div><span className="vf-kicker">{mode === 'fleet' ? '車管工作台' : '當班監控'}</span><h2>{mode === 'fleet' ? '每一則通報，都有後續' : '收件匣'}</h2><p>{mode === 'fleet' ? '跨班保留案件，從接手到結案，在這裡完成。' : '只將通報當下值班的通知放入個人收件匣；緊急程度由你判定。'}</p></div><span className="vf-hero-icon">{mode === 'fleet' ? <Truck size={30} /> : <Inbox size={30} />}</span></header>}
    <div className="vf-inbox-toolbar"><div className="vf-inbox-count"><b>{unread}</b><span>封未讀<small>目前載入 {reports.length} 件</small></span></div><label className="vf-search"><span className="vf-sr-only">搜尋車牌、姓名或員編</span><input type="search" placeholder="搜尋車牌、姓名或員編" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="vf-icon-button" disabled={loading} onClick={() => void load()} aria-label="重新載入收件匣"><RefreshCw size={18} className={loading ? 'vf-spin' : ''} /></button></div>
    {mode === 'monitor' && <div className="vf-mailbox-switch"><button className={!unrouted ? 'is-active' : ''} onClick={() => setUnrouted(false)}>我的收件匣</button><button className={unrouted ? 'is-active' : ''} onClick={() => setUnrouted(true)}>待確認通知對象</button><small>早 07–17 · 晚 12–21 · 夜 21–07</small></div>}
    <nav className="vf-filters" aria-label="通報狀態">{[['all', '全部'], ['unread', '未讀'], ['pending', '待處理'], ['in_progress', '處理中'], ['completed', '已完成']].map(([value, label]) => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</nav>
    <ErrorMessage message={error} />
    <div className="vf-mail-layout"><section className="vf-letter-list" aria-label="通報列表">
      {!visible.length && <div className="vf-empty"><Inbox size={32} /><strong>{loading ? '正在載入通報…' : '目前沒有符合的通報'}</strong><span>{loading ? '不會影響其他功能' : '新通報會保留在這裡，按重新載入取得最新進度。'}</span></div>}
      {visible.map(report => <button key={report.id} className={`vf-letter ${selected === report.id ? 'is-selected' : ''} ${report.unread ? 'is-unread' : ''}`} onClick={() => setSelected(report.id)}><div className="vf-letter-top"><strong>{report.vehicleNo}</strong><Badge report={report} /></div><p>{report.faultType}<span className={`vf-priority vf-${report.priority}`}>{faultPriority[report.priority]}</span></p><span className="vf-excerpt">{report.description}</span><footer><span>{report.reporterName} · {time(report.createdAt)}</span>{report.unread ? <span className="vf-unread-dot" aria-label="未讀" /> : <ChevronRight size={15} />}</footer></button>)}
      {cursor && <button className="vf-load-more" disabled={loading} onClick={() => void load(cursor)}>載入更多通報</button>}
    </section>
    <section className="vf-detail-panel" aria-label="通報內容">{selected && access ? <ReportDetail key={`${lane}-${selected}`} reportId={selected} lane={lane} access={access} onBack={() => setSelected(null)} onReport={report => setReports(old => old.map(r => r.id === report.id ? report : r))} /> : <div className="vf-empty vf-detail-empty"><MessageSquareText size={38} /><strong>選一則通報，查看完整內容</strong><span>已讀只代表看過，不會自動結案。</span></div>}</section></div>
  </section>
}

function ReportDetail({ reportId, lane, access, onBack, onReport }: { reportId: string; lane: FaultLane; access: FaultAccess; onBack: () => void; onReport: (report: FaultReport) => void }) {
  const [report, setReport] = useState<FaultReport | null>(null)
  const [events, setEvents] = useState<FaultEvent[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [priority, setPriority] = useState('normal')
  const [note, setNote] = useState('')
  const [completion, setCompletion] = useState('')
  const alive = useRef(true)
  const load = async () => {
    const result = await vehicleFaultCall<{ report: FaultReport; events: FaultEvent[] }>('detail', { reportId, lane })
    if (!alive.current) return
    setReport(result.report); setEvents(result.events); onReport(result.report)
    setPriority(result.report.priority === 'unassessed' ? 'normal' : result.report.priority); setNote(result.report.monitorNote)
  }
  useEffect(() => { alive.current = true; void load().catch(reason => { if (alive.current) setError(faultError(reason)) }); return () => { alive.current = false } }, [reportId, lane])
  async function update(action: string) {
    if (!report || busy) return
    setBusy(true); setError('')
    try { await vehicleFaultCall(action, { reportId, version: report.version, priority, note: action === 'complete' ? completion : note }); await load() }
    catch (reason) { if (alive.current) setError(faultError(reason)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <article className="vf-detail"><button className="vf-back" onClick={onBack}><ArrowLeft size={17} />返回收件匣</button><ErrorMessage message={error} />{!report ? <div className="vf-empty">{error ? <button onClick={() => { setError(''); void load().catch(reason => setError(faultError(reason))) }}>重新載入內容</button> : '正在開啟通報…'}</div> : <>
    <header className="vf-detail-heading"><div><small>{report.faultType}</small><h2>{report.vehicleNo}</h2></div><Badge report={report} /></header>
    <div className="vf-detail-meta"><span>通報人員<strong>{report.reporterName} · {report.reporterId}</strong></span><span>通報時間<strong>{time(report.createdAt)}</strong></span><span>緊急程度<strong className={`vf-priority vf-${report.priority}`}>{faultPriority[report.priority]}</strong></span><span>接手車管<strong>{report.assigneeName || '尚未接手'}</strong></span></div>
    {report.routingStatus === 'unresolved' && <div className="vf-warning">此通報已保存，但尚未找到可確認的當班監控。請監控依正式班表人工確認；系統未發送全員通知。</div>}
    {lane !== 'employee' && ['failed', 'partial', 'uncertain', 'no_tokens'].includes(report.notificationStatus) && <div className="vf-warning">裝置通知尚未確認完整送達，請以此收件匣的案件內容為準。</div>}
    <section className="vf-detail-section"><h3>故障描述</h3><p className="vf-description">{report.description}</p></section>
    {report.attachments.length > 0 && <section className="vf-detail-section"><h3>照片與影片 <span>{report.attachments.length}</span></h3><div className="vf-attachments">{report.attachments.map(file => <PrivateAttachment key={file.index} reportId={report.id} index={file.index} mime={file.mime} />)}</div></section>}
    {report.monitorNote && <section className="vf-detail-section"><h3>監控處置</h3><p className="vf-description">{report.monitorNote}</p></section>}
    {report.completionNote && <section className="vf-completed-note"><CheckCircle2 size={20} /><div><strong>維修完成說明</strong><p className="vf-description">{report.completionNote}</p></div></section>}
    {lane === 'monitor' || lane === 'unrouted' ? access.duty && report.status !== 'completed' && <section className="vf-action-panel"><h3>監控判定</h3><fieldset disabled={busy}><label>緊急程度<select value={priority} onChange={e => setPriority(e.target.value)}><option value="normal">一般</option><option value="priority">優先</option><option value="urgent">緊急</option></select></label><label>處置備註<textarea rows={3} maxLength={2000} value={note} placeholder="例如已請駕駛停止使用，安排備用車。" onChange={e => setNote(e.target.value)} /></label><button className="vf-primary" onClick={() => void update('triage')} disabled={busy}><ShieldCheck size={17} />{busy ? '正在儲存…' : '確認並儲存判定'}</button></fieldset></section> : null}
    {lane === 'fleet' && access.fleet && report.status !== 'completed' && <section className="vf-action-panel"><h3>車管處理</h3>{report.status === 'pending' ? <><p>接手後會記錄你的姓名，其他車管可查看進度。</p><button className="vf-primary" disabled={busy} onClick={() => void update('start')}><Wrench size={17} />{busy ? '正在接手…' : '由我接手處理'}</button></> : (access.admin || report.assigneeId === access.employeeId) ? <fieldset disabled={busy}><label>維修結果<span className="vf-required">必填</span><textarea rows={3} maxLength={2000} value={completion} onChange={e => setCompletion(e.target.value)} placeholder="請說明檢修結果、處理方式與車輛是否恢復使用。" /></label><button className="vf-primary" disabled={busy || !completion.trim()} onClick={() => void update('complete')}><CheckCircle2 size={17} />{busy ? '正在儲存…' : '完成處理並結案'}</button></fieldset> : <p>目前由 {report.assigneeName} 處理，保留給接手人員完成結案。</p>}</section>}
    <section className="vf-detail-section"><h3>處理歷程</h3><ol className="vf-timeline">{events.map(event => <li key={event.id}><span /><div><strong>{({ submitted: '已送出通報', triage: '監控更新判定', start: '車管接手處理', complete: '已完成處理' } as Record<string, string>)[event.action] || '更新'}<small>{event.actorName} · {time(event.createdAt)}</small></strong>{event.note && <p>{event.note}</p>}</div></li>)}</ol></section>
  </>}</article>
}

function PrivateAttachment({ reportId, index, mime }: { reportId: string; index: number; mime: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const objectUrl = useRef('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) } }, [])
  async function open() {
    setBusy(true); setError('')
    try {
      const media = await vehicleFaultCall<{ mime: string; base64: string }>('attachment', { reportId, index })
      if (!alive.current) return
      const bytes = Uint8Array.from(atob(media.base64), character => character.charCodeAt(0))
      objectUrl.current = URL.createObjectURL(new Blob([bytes], { type: media.mime })); setUrl(objectUrl.current)
    } catch (reason) { if (alive.current) setError(faultError(reason)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div className="vf-attachment">{url ? mime.startsWith('video/') ? <video src={url} controls playsInline preload="metadata" /> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`故障照片 ${index + 1}`} /></a> : <button onClick={() => void open()} disabled={busy}><FileImage size={25} /><span>{busy ? '正在安全讀取…' : `開啟${mime.startsWith('video/') ? '影片' : '照片'} ${index + 1}`}</span><small>僅授權人員可查看</small></button>}<ErrorMessage message={error} /></div>
}
