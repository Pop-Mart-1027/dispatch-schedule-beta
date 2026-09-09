'use client'

import './matrix.css'
import './area-fix.css'
import './dispatch.css'
import './youbike-theme.css'
import './mobile-nav.css'
import './mobile-layout.css'
import { Fragment, useEffect, useState } from 'react'
import { browserLocalPersistence, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardList, ClipboardPlus, Clock3, Coffee, KeyRound, LocateFixed, LogOut, MapPin, Megaphone, Menu, Plus, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import { auth, db, employeeEmail, functions } from '../lib/firebase'
import { evaluateGeofence, GEOFENCE_WARNING_ACCURACY_METERS } from '../lib/geofence'
import { buildAttendanceRecord, canSubmitPunch, getPunchBlockReason, hasTodayPunch, type AttendanceLocation, type AttendanceRecord, type PunchType } from '../lib/attendance'
import { listAttendanceLocations, listTodayAttendanceRecords, createAttendanceRecord, removeAttendanceLocation, saveAttendanceLocation } from '../lib/attendance-firestore'
import { listMonthScheduleRecords, listScheduleRecords, type ScheduleRecord } from '../lib/schedule-firestore'
import { listAreaMaster, listDispatchRecords, updateDispatchRecord, writeDispatchAudit, type AreaMaster, type DispatchRecord } from '../lib/dispatch-firestore'
import { getBroadcastRead, listActiveBroadcasts, recordBroadcastShown, type Broadcast } from '../lib/broadcasts'
import sourceSchedule from '../public/september-schedules.json'
import finalDispatchMapping from '../output/dispatch-area-mapping-final.json'

type ScheduleRow = { rowId: string; employeeId: string; name: string; title: string; group: string; area: string; shifts: string[] }
type ScheduleData = { month: string; days: string[]; morning: ScheduleRow[]; night: ScheduleRow[] }
type Employee = { employeeId: string; name: string; title: string; role: 'employee' | 'duty' | 'admin'; hireDate: string; active: boolean; mustChangePassword: boolean }
type EmployeeProfile = { employeeId: string; name: string; title?: string; group?: string; area?: string }
type PunchRecord = AttendanceRecord
type Checkpoint = AttendanceLocation
const attendanceEnabled = false
const weekdays = ['二', '三', '四', '五', '六', '日', '一']
const publicAssetUrl = (file: string) => `${import.meta.env.BASE_URL}${file.replace(/^\//, '')}`

export default function Home() {
  const [authReady, setAuthReady] = useState(false)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [currentUser, setCurrentUser] = useState<Employee | null>(null)
  const [page, setPage] = useState('home')
  const [scheduleTab, setScheduleTab] = useState('mine')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [broadcastPopup, setBroadcastPopup] = useState<Broadcast | null>(null)
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)
  const notify = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 2500) }
  const [signingIn, setSigningIn] = useState(false)
  const signIn = async () => {
    const employeeId = account.trim().toUpperCase()
    if (!employeeId || !password) return notify('請輸入員工編號與密碼')
    setSigningIn(true)
    try {
      await setPersistence(auth, browserLocalPersistence)
      await signInWithEmailAndPassword(auth, employeeEmail(employeeId), password)
      setPassword('')
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      notify(code === 'auth/user-disabled' ? '帳號已停用，請洽管理員' : '員工編號或密碼錯誤')
    } finally {
      setSigningIn(false)
    }
  }

  useEffect(() => {
    if (!currentUser) return
    void Promise.all([listMonthScheduleRecords('2026-09'), getDocs(collection(db, 'employees'))]).then(([records, employees]) => { const profiles = employees.docs.map(item => ({ employeeId: item.id, ...(item.data() as Omit<EmployeeProfile, 'employeeId'>) })); console.info('[scheduleRecords] loaded', { employeeId: 'all', count: records.length }); setScheduleData(scheduleRecordsToData(records, profiles)); if (!records.length) notify('班表資料尚未匯入') }).catch(error => { console.error('[scheduleRecords] load failed', error); setScheduleData(scheduleRecordsToData([])); notify(error?.code === 'permission-denied' ? '班表讀取權限不足' : '班表資料載入失敗') })
  }, [currentUser?.employeeId])

  useEffect(() => onAuthStateChanged(auth, async user => {
    if (!user) { setCurrentUser(null); setAuthReady(true); return }
    try {
      const getMyProfile = httpsCallable<undefined, Employee>(functions, 'getMyProfile')
      const result = await getMyProfile()
      if (!result.data.active) throw new Error('inactive')
      setAccount(result.data.employeeId)
      setCurrentUser(result.data)
    } catch {
      await signOut(auth)
      notify('帳號已停用或員工主檔不存在')
    } finally {
      setAuthReady(true)
    }
  }), [])

  useEffect(() => {
    if (!currentUser) return
    return onSnapshot(doc(db, 'employees', currentUser.employeeId), snapshot => {
      if (!snapshot.exists() || snapshot.data().active !== true) {
        void signOut(auth)
        notify('帳號已停用，已為你登出')
      }
    })
  }, [currentUser?.employeeId])

  useEffect(() => {
    if (!currentUser) return
    void showEligibleBroadcast(currentUser).then(item => { if (item) setBroadcastPopup(item) })
  }, [currentUser?.employeeId])

  if (!authReady) return <main className="login-page"><p className="loading">正在確認登入狀態…</p></main>
  if (!currentUser) return <main className="login-page"><section className="login-card"><div className="login-bike"><BikeArtwork /></div><p className="eyebrow">YOUBIKE DISPATCH BETA</p><h1 className="login-brand"><span className="smile-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="10" cy="11" r="2" fill="currentColor" /><circle cx="22" cy="11" r="2" fill="currentColor" /><path d="M8 19C10 27 22 27 24 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg></span>微笑Bike</h1><label>員工編號<input autoComplete="username" placeholder="請使用本人員工編號登入" value={account} onChange={e => setAccount(e.target.value.toUpperCase())} /></label><label>密碼<input type="password" autoComplete="current-password" placeholder="首次登入密碼為編號" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && void signIn()} /></label><button className="primary full" disabled={signingIn} onClick={() => void signIn()}>{signingIn ? '登入中…' : '登入工作台'} <ChevronRight size={18} /></button>{notice && <p className="error">{notice}</p>}</section></main>

  if (currentUser.mustChangePassword) return <ChangePassword employee={currentUser} onDone={async () => { await signOut(auth); setCurrentUser(null); notify('密碼已更新，請使用新密碼重新登入') }} />

  const titles: Record<string, string> = { home: '工作總覽', notice: '公告', broadcasts: '廣播事項', 'dispatch-admin': '派工管理', 'broadcast-admin': '廣播管理', attendance: '打卡', checkpoints: '打卡點管理', geofence: '電子圍籬測試', schedule: '我的班表', dispatch: '派工單', pre: '預排班', leave: '假勤／特休', profile: '個人資料', employees: '員工管理', integrations: '尚未串接' }
  const go = (target: string) => { setPage(target); setMenuOpen(false) }
  return <div className="app-shell" data-page={page}>{menuOpen && <button className="mobile-backdrop" aria-label="關閉選單" onClick={() => setMenuOpen(false)} />}<aside className={menuOpen ? 'sidebar open' : 'sidebar'}><div className="logo"><span>調</span><div><strong>調度工作台</strong><small>DISPATCH BETA</small></div><button className="drawer-close" aria-label="關閉選單" onClick={() => setMenuOpen(false)}><X size={20} /></button></div><nav><Nav label="工作總覽" active={page === 'home'} icon={<Coffee size={18} />} onClick={() => go('home')} />{attendanceEnabled && <Nav label="打卡" active={page === 'attendance'} icon={<CheckCircle2 size={18} />} onClick={() => go('attendance')} />}<Nav label="公告" active={page === 'notice'} icon={<Megaphone size={18} />} onClick={() => go('notice')} /><Nav label="廣播事項" active={page === 'broadcasts'} icon={<Megaphone size={18} />} onClick={() => go('broadcasts')} /><Nav label="我的班表" active={page === 'schedule'} icon={<CalendarDays size={18} />} onClick={() => go('schedule')} /><Nav label="派工單" active={page === 'dispatch'} icon={<ClipboardList size={18} />} onClick={() => go('dispatch')} /><Nav label="預排班" active={page === 'pre'} icon={<Clock3 size={18} />} onClick={() => go('pre')} /><Nav label="假勤／特休" active={page === 'leave'} icon={<ClipboardPlus size={18} />} onClick={() => go('leave')} /><Nav label="個人資料" active={page === 'profile'} icon={<UserRound size={18} />} onClick={() => go('profile')} />{(currentUser.role === 'admin' || currentUser.role === 'duty') && <Nav label="派工管理" active={page === 'dispatch-admin'} icon={<ClipboardList size={18} />} onClick={() => go('dispatch-admin')} />}{currentUser.role === 'admin' && <><Nav label="廣播管理" active={page === 'broadcast-admin'} icon={<Megaphone size={18} />} onClick={() => go('broadcast-admin')} /><Nav label="打卡點管理" active={page === 'checkpoints'} icon={<MapPin size={18} />} onClick={() => go('checkpoints')} /><Nav label="圍籬測試" active={page === 'geofence'} icon={<LocateFixed size={18} />} onClick={() => go('geofence')} /><Nav label="員工管理" active={page === 'employees'} icon={<ShieldCheck size={18} />} onClick={() => go('employees')} /></>}<Nav label="尚未串接" active={page === 'integrations'} icon={<Clock3 size={18} />} onClick={() => go('integrations')} /></nav><button className="logout" onClick={() => void signOut(auth)}><LogOut size={17} />登出</button></aside><main className="workspace"><header className="topbar"><button className="menu-button" aria-label="開啟選單" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><div><p className="eyebrow">2026 年 9 月</p><h2>{titles[page]}</h2></div><div className="profile-chip"><b>{currentUser.name[0]}</b><span>{currentUser.name}<small>{account} · {currentUser.role === 'admin' ? '管理員' : '調度專員'}</small></span></div></header><section className="content">{page === 'home' && <HomeView onAction={notify} name={currentUser.name} onGo={go} />}{page === 'notice' && <EmptyNotice />}{page === 'broadcasts' && <BroadcastList employeeId={account} />}{page === 'broadcast-admin' && currentUser.role === 'admin' && <BroadcastAdmin employeeId={account} />}{page === 'dispatch-admin' && (currentUser.role === 'admin' || currentUser.role === 'duty') && <DispatchAdmin employeeId={account} />}{page === 'attendance' && attendanceEnabled && <AttendanceView employeeId={account} employeeName={currentUser.name} scheduleData={scheduleData} />}{page === 'checkpoints' && currentUser.role === 'admin' && <CheckpointAdmin />}{page === 'geofence' && currentUser.role === 'admin' && <GeofenceTest />}{page === 'integrations' && <IntegrationsView />}{page === 'schedule' && <ScheduleView tab={scheduleTab} setTab={setScheduleTab} data={scheduleData} employeeId={account} />}{page === 'dispatch' && <FirestoreDispatchView employeeId={account} isDuty={currentUser.role === 'admin' || currentUser.role === 'duty'} />}{page === 'pre' && <PreSchedule onSave={() => notify('預排班已儲存為草稿')} />}{page === 'leave' && <LeaveView onAction={notify} />}{page === 'profile' && <ProfileView employee={currentUser} />}{page === 'employees' && currentUser.role === 'admin' && <AdminEmployees notify={notify} />}</section></main>{notice && <div className="toast">✓ {notice}</div>}{broadcastPopup && <BroadcastModal item={broadcastPopup} onClose={() => setBroadcastPopup(null)} />}</div>
}

function Nav({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) { return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span></button> }

function scheduleRecordsToData(records: ScheduleRecord[], profiles: EmployeeProfile[] = []): ScheduleData {
  const days = Array.from({ length: 30 }, (_, i) => String(i + 1))
  const profileMap = new Map(profiles.map(profile => [profile.employeeId, profile]))
  const sourceRows = [...sourceSchedule.morning.map(row => ({ ...row, shiftType: 'morning' as const })), ...sourceSchedule.night.map(row => ({ ...row, shiftType: 'night' as const }))]
  const sourceMap = new Map(sourceRows.map(row => [`${row.shiftType}:${row.employeeId}`, row]))
  const grouped = new Map<string, ScheduleRow>()
  for (const record of records) {
    const key = `${record.shiftType}:${record.employeeId}`
    const day = Number(record.date.slice(8)) - 1
    const profile = profileMap.get(record.employeeId)
    const source = sourceMap.get(key)
    const current = grouped.get(key) ?? { rowId: record.employeeId, employeeId: record.employeeId, name: profile?.name || record.employeeName, title: profile?.title || record.title || source?.title || '', group: profile?.group || record.group || source?.group || '', area: profile?.area || record.area || source?.area || '', shifts: Array(30).fill('') }
    current.shifts[day] = record.scheduleCode || record.scheduleLabel || record.leaveType || ''
    grouped.set(key, current)
  }
  return { month: '2026-09', days, morning: [...grouped.values()].filter(row => records.some(r => r.employeeId === row.employeeId && r.shiftType === 'morning')), night: [...grouped.values()].filter(row => records.some(r => r.employeeId === row.employeeId && r.shiftType === 'night')) }
}

async function showEligibleBroadcast(user: Employee): Promise<Broadcast | undefined> {
  try {
    const [broadcasts, monthSchedule] = await Promise.all([listActiveBroadcasts(), listMonthScheduleRecords(taipeiToday().slice(0, 7), user.employeeId)])
    const shiftGroups = new Set(monthSchedule.map(record => record.shiftType === 'morning' ? '早班' : '夜班'))
    const targetMatches = (item: Broadcast) => {
      const values = (item.targetValues || []).map(value => value.toLowerCase())
      if (item.targetType === 'employee') return values.includes(user.employeeId.toLowerCase())
      if (item.targetType === 'morning') return shiftGroups.has('早班') && (!values.length || values.some(value => ['早班', 'morning', '早'].includes(value)))
      if (item.targetType === 'night') return shiftGroups.has('夜班') && (!values.length || values.some(value => ['夜班', 'night', '晚', '夜'].includes(value)))
      if (item.targetType === 'area') return monthSchedule.some(record => values.includes(record.scheduleCode.toLowerCase()))
      return item.targetType === 'all'
    }
    const now = Date.now()
    const match = broadcasts.find(item => {
      const start = item.startAt && typeof item.startAt === 'object' && 'toDate' in item.startAt ? (item.startAt as { toDate: () => Date }).toDate().getTime() : 0
      const end = item.endAt && typeof item.endAt === 'object' && 'toDate' in item.endAt ? (item.endAt as { toDate: () => Date }).toDate().getTime() : Number.MAX_SAFE_INTEGER
      if (start > now || end < now || !item.active) return false
      return targetMatches(item)
    })
    if (!match || match.popupMode === 'none') return
    const read = await getBroadcastRead(match.id, user.employeeId)
    const today = taipeiToday()
    const last = read?.lastShownAt && typeof read.lastShownAt === 'object' && 'toDate' in read.lastShownAt ? taipeiDate((read.lastShownAt as { toDate: () => Date }).toDate()) : ''
    if (match.popupMode === 'once' && read) return
    if (match.popupMode === 'daily' && last === today) return
    await recordBroadcastShown({ broadcastId: match.id, employeeId: user.employeeId, shownCount: read?.shownCount ?? 0 })
    return match
  } catch { /* Broadcast availability must not block app startup. */ return undefined }
}

function BroadcastModal({ item, onClose }: { item: Broadcast; onClose: () => void }) {
  return <div className="broadcast-modal-backdrop" role="presentation"><section className={`broadcast-modal broadcast-modal-${item.type}`} role="dialog" aria-modal="true" aria-labelledby="broadcast-title"><button className="broadcast-close" aria-label="關閉廣播" onClick={onClose}><X size={18} /></button><p className="eyebrow">廣播事項</p><h2 id="broadcast-title">{item.title}</h2><p>{item.content}</p>{item.imageUrl && <img src={item.imageUrl} alt="廣播圖片" />}{item.linkUrl && <a href={item.linkUrl} target="_blank" rel="noreferrer">查看連結</a>}<button className="primary full" onClick={onClose}>我知道了</button></section></div>
}

function taipeiDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function BroadcastList({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<Broadcast[]>([])
  useEffect(() => { void getDocs(query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc'))).then(snapshot => setItems(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Broadcast)))).catch(() => setItems([])) }, [employeeId])
  return <section className="form-card"><p className="eyebrow">BROADCASTS · FIRESTORE</p><h1>廣播事項</h1><div className="table-card">{items.length ? items.map(item => <article className={`notice-card notice-${item.type}`} key={item.id}><h3>{item.title} {!item.active && <small>（已停用）</small>}</h3><p>{item.content}</p>{item.imageUrl && <img src={item.imageUrl} alt="廣播圖片" />}</article>) : <p className="muted">目前沒有廣播。</p>}</div></section>
}

function BroadcastAdmin({ employeeId }: { employeeId: string }) {
  type Draft = { title: string; content: string; type: Broadcast['type']; targetType: Broadcast['targetType']; targetValues: string[]; startAt: string; endAt: string; popupMode: Broadcast['popupMode']; active: boolean; imageUrl: string; linkUrl: string }
  const blank: Draft = { title: ' ', content: '', type: '一般', targetType: 'all', targetValues: [], startAt: '', endAt: '', popupMode: 'daily', active: true, imageUrl: '', linkUrl: '' }
  const [items, setItems] = useState<Broadcast[]>([]); const [editing, setEditing] = useState<Broadcast | null>(null); const [editorOpen, setEditorOpen] = useState(false); const [draft, setDraft] = useState<Draft>(blank); const [saving, setSaving] = useState(false); const [people, setPeople] = useState<Array<{ employeeId: string; name: string }>>([]); const [personSearch, setPersonSearch] = useState('')
  const load = async () => { const snapshot = await getDocs(query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc'))); setItems(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Broadcast))) }
  useEffect(() => { void load(); void getDocs(query(collection(db, 'employees'), orderBy('employeeId', 'asc'))).then(snapshot => setPeople(snapshot.docs.map(item => ({ employeeId: item.id, name: String(item.data().name || '') })))).catch(() => setPeople([])) }, [])
  const dateValue = (value: unknown) => value && typeof value === 'object' && 'toDate' in value ? (value as { toDate: () => Date }).toDate().toISOString().slice(0, 16) : ''
  const closeEditor = () => { setEditorOpen(false); setEditing(null) }
  const open = (item?: Broadcast) => { setEditorOpen(true); setEditing(item || null); setDraft(item ? { title: item.title, content: item.content, type: item.type, targetType: item.targetType, targetValues: item.targetValues || [], startAt: dateValue(item.startAt), endAt: dateValue(item.endAt), popupMode: item.popupMode, active: item.active, imageUrl: item.imageUrl || '', linkUrl: item.linkUrl || '' } : { ...blank }) }
  const save = async () => { if (!draft.title.trim() || !draft.content.trim()) return; setSaving(true); const payload = { ...draft, title: draft.title.trim(), content: draft.content.trim(), startAt: draft.startAt ? Timestamp.fromDate(new Date(draft.startAt)) : null, endAt: draft.endAt ? Timestamp.fromDate(new Date(draft.endAt)) : null, updatedAt: serverTimestamp() }; try { if (editing) await updateDoc(doc(db, 'broadcasts', editing.id), payload); else await addDoc(collection(db, 'broadcasts'), { ...payload, createdBy: employeeId, createdAt: serverTimestamp() }); open(); await load() } finally { setSaving(false) } }
  const toggle = async (item: Broadcast) => { await updateDoc(doc(db, 'broadcasts', item.id), { active: !item.active, updatedAt: serverTimestamp() }); await load() }
  const remove = async (item: Broadcast) => { if (!window.confirm(`刪除「${item.title}」？`)) return; await deleteDoc(doc(db, 'broadcasts', item.id)); await load() }
  const copy = (item: Broadcast) => open({ ...item, id: '', title: `${item.title}（複製）`, active: false })
  const selectedPeople = people.filter(p => draft.targetValues.includes(p.employeeId)); const searchPeople = people.filter(p => `${p.employeeId} ${p.name}`.includes(personSearch)).slice(0, 20)
  return <section><div className="page-intro"><div><p className="eyebrow">BROADCAST ADMIN · FIRESTORE</p><h1>廣播管理</h1><p className="muted">控制前台顯示時間、對象與彈出規則。</p></div><button className="primary" onClick={() => open()}>新增廣播</button></div><div className="table-card broadcast-admin-list">{items.map(item => <div className="list-row" key={item.id}><span><strong>{item.title}</strong><small>{item.type} · {item.targetType} · {item.popupMode} · {item.active ? '啟用' : '停用'}</small></span><div className="row-actions"><button onClick={() => open(item)}>修改</button><button onClick={() => void toggle(item)}>{item.active ? '停用' : '啟用'}</button><button onClick={() => copy(item)}>複製</button><button onClick={() => void remove(item)}>刪除</button><button onClick={() => open(item)}>預覽／編輯</button></div></div>)}</div>{(editing || draft.title !== '') && <div className="broadcast-modal-backdrop"><section className="broadcast-modal dispatch-editor" role="dialog"><button className="broadcast-close" onClick={() => open()}><X size={18} /></button><p className="eyebrow">{editing ? '編輯廣播' : '新增廣播'}</p><label>標題<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>內文<textarea value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></label><div className="two-fields"><label>類型<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as Draft['type'] })}><option>一般</option><option>提醒</option><option>重要</option></select></label><label>顯示模式<select value={draft.popupMode} onChange={e => setDraft({ ...draft, popupMode: e.target.value as Draft['popupMode'] })}><option value="once">once</option><option value="daily">daily</option><option value="always">always</option><option value="none">none</option></select></label></div><div className="two-fields"><label>開始時間<input type="datetime-local" value={draft.startAt} onChange={e => setDraft({ ...draft, startAt: e.target.value })} /></label><label>結束時間<input type="datetime-local" value={draft.endAt} onChange={e => setDraft({ ...draft, endAt: e.target.value })} /></label></div><label>指定對象<select value={draft.targetType} onChange={e => setDraft({ ...draft, targetType: e.target.value as Draft['targetType'], targetValues: [] })}><option value="all">全體</option><option value="morning">早班</option><option value="night">夜班</option><option value="area">指定區域</option><option value="employee">指定員工</option></select></label>{draft.targetType === 'area' && <input placeholder="輸入區域代碼，多個以逗號分隔" value={draft.targetValues.join(',')} onChange={e => setDraft({ ...draft, targetValues: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} />}{draft.targetType === 'employee' && <><input placeholder="以員編或姓名搜尋" value={personSearch} onChange={e => setPersonSearch(e.target.value)} /><div className="person-picker">{searchPeople.map(person => <button key={person.employeeId} className={draft.targetValues.includes(person.employeeId) ? 'selected' : ''} onClick={() => setDraft({ ...draft, targetValues: draft.targetValues.includes(person.employeeId) ? draft.targetValues.filter(id => id !== person.employeeId) : [...draft.targetValues, person.employeeId] })}>{person.employeeId} · {person.name}</button>)}</div><small>已選：{selectedPeople.map(person => person.name).join('、') || '尚未選擇'}</small></>}<label>圖片 URL<input value={draft.imageUrl} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} /></label><label>連結 URL<input value={draft.linkUrl} onChange={e => setDraft({ ...draft, linkUrl: e.target.value })} /></label><label><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /> 啟用</label><div className={`notice-card notice-${draft.type}`}><h3>{draft.title || '預覽標題'}</h3><p>{draft.content || '預覽內容'}</p>{draft.imageUrl && <img src={draft.imageUrl} alt="預覽圖片" />}</div><button className="primary full" disabled={saving} onClick={() => void save()}>儲存</button></section></div>}</section>
}

function BikeArtwork() { return <div className="bike-art"><img src={publicAssetUrl('youbike-cutout.png')} alt="YouBike 橘白色腳踏車" /></div> }

function HomeView({ onAction, name, onGo }: { onAction: (text: string) => void; name: string; onGo: (page: string) => void }) { return <><section className="welcome"><div><p className="eyebrow">WELCOME BACK</p><h1>你好，{name}。</h1><p className="muted">今天也一起順利出勤。</p></div><BikeArtwork /></section><section className="quick-section"><div><p className="eyebrow">QUICK ACTIONS</p><h2>快速選單</h2></div><div className="quick-grid"><button className="quick-card" onClick={() => onGo('schedule')}><span className="quick-icon start">▣</span><strong>查看我的班表</strong><small>查看今日與本月班表</small></button><button className="quick-card" onClick={() => onGo('dispatch')}><span className="quick-icon end">→</span><strong>查看派工單</strong><small>查看正式派工資料</small></button><button className="quick-card" onClick={() => onAction('請假申請尚未串接後端')}><span className="quick-icon leave">＋</span><strong>我要請假</strong><small>病假、事假與特休申請</small></button></div></section></> }

function todayWorkContext(data: ScheduleData | null, employeeId: string) {
  if (!data || data.month.replace('/', '-') !== taipeiToday().slice(0, 7)) return { scheduleCode: '', dispatchAreaCode: '', hasSchedule: false, hasDispatch: false }
  const day = Number(taipeiToday().slice(8)) - 1
  const row = [...data.morning, ...data.night].find(item => item.employeeId === employeeId)
  const scheduleCode = row?.shifts[day] ?? ''
  const dispatchAreaCode = scheduleCode && !isLeave(scheduleCode) ? dispatchArea(scheduleCode) || (row ? dispatchSpecialGroup(row) : '') : ''
  return { scheduleCode, dispatchAreaCode, hasSchedule: Boolean(scheduleCode && !isLeave(scheduleCode)), hasDispatch: Boolean(dispatchAreaCode) }
}

function AttendanceView({ employeeId, employeeName, scheduleData }: { employeeId: string; employeeName: string; scheduleData: ScheduleData | null }) {
  const [records, setRecords] = useState<PunchRecord[]>([]); const [locations, setLocations] = useState<AttendanceLocation[]>([]); const [checking, setChecking] = useState(false); const [geoMessage, setGeoMessage] = useState(''); const [geoResult, setGeoResult] = useState<ReturnType<typeof evaluateGeofence> | null>(null); const context = todayWorkContext(scheduleData, employeeId)
  useEffect(() => { void (async () => { try { setLocations(await listAttendanceLocations()); setRecords(await listTodayAttendanceRecords(employeeId, taipeiToday())) } catch { setLocations([]); setRecords([]); setGeoMessage('打卡資料載入失敗，請確認網路後重新整理') } })() }, [employeeId])
  const punch = (type: PunchType) => { const block = getPunchBlockReason(records, type, taipeiToday()); if (checking || block) { setGeoMessage(block || '處理中，請稍候'); return } if (!context.hasSchedule) { setGeoMessage(context.scheduleCode ? '今日尚未派工' : '今日無排班'); return } if (!context.hasDispatch) { setGeoMessage('今日尚未派工，禁止正式打卡'); return } setChecking(true); setGeoMessage('正在取得 GPS 位置…'); setGeoResult(null); if (!navigator.geolocation) { setGeoMessage('請開啟裝置定位權限後再試'); setChecking(false); return } navigator.geolocation.getCurrentPosition(async position => { const result = evaluateGeofence({ latitude: position.coords.latitude, longitude: position.coords.longitude }, locations.filter(location => location.areaCode === context.dispatchAreaCode)); setGeoResult(result); const accuracyWarning = position.coords.accuracy > GEOFENCE_WARNING_ACCURACY_METERS ? `定位精度較差（${Math.round(position.coords.accuracy)}m），結果僅供參考。` : ''; if (!result.canPunch) setGeoMessage(`${accuracyWarning} 此區域尚未設定打卡地點，或目前不在範圍內，禁止打卡`); else { const record = buildAttendanceRecord({ employeeId, employeeName, punchType: type, scheduleCode: context.scheduleCode, dispatchAreaCode: context.dispatchAreaCode, position: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }, evaluation: result }); try { await createAttendanceRecord(record); setRecords(current => [record, ...current]); setGeoMessage(`${accuracyWarning} ${type}打卡成功`) } catch { setGeoMessage('打卡紀錄寫入失敗，請確認網路後重試') } } setChecking(false) }, error => { setGeoMessage(error.code === error.PERMISSION_DENIED ? 'GPS 權限被拒絕，請在瀏覽器設定中允許定位後重試' : `無法取得 GPS：${error.message}`); setChecking(false) }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }) }
  const contextMessage = !context.hasSchedule ? (context.scheduleCode ? '今日尚未派工' : '今日無排班') : !context.hasDispatch ? '今日尚未派工' : ''
  return <section className="form-card"><p className="eyebrow">ATTENDANCE · FIRESTORE</p><h1>打卡</h1><p className="muted">{contextMessage || '打卡前會取得 GPS，並依今日派工區域判定電子圍籬。'}</p>{contextMessage && <div className="result-card result-warning">{contextMessage}</div>}<div className="quick-grid"><button className="quick-card" disabled={checking || Boolean(contextMessage) || Boolean(getPunchBlockReason(records, '上班', taipeiToday()))} onClick={() => punch('上班')}><span className="quick-icon start">↑</span><strong>上班打卡</strong><small>{getPunchBlockReason(records, '上班', taipeiToday()) || '取得 GPS 後打卡'}</small></button><button className="quick-card" disabled={checking || Boolean(contextMessage) || Boolean(getPunchBlockReason(records, '下班', taipeiToday()))} onClick={() => punch('下班')}><span className="quick-icon end">↓</span><strong>下班打卡</strong><small>{getPunchBlockReason(records, '下班', taipeiToday()) || '取得 GPS 後打卡'}</small></button></div>{geoMessage && <div className={`result-card ${geoResult?.canPunch ? 'result-success' : 'result-warning'}`}><strong>{geoMessage}</strong>{geoResult?.nearest ? <small>最近打卡點：{geoResult.nearest.checkpoint.name} · 距離 {Math.round(geoResult.nearest.distanceMeters)}m · 允許半徑 {geoResult.nearest.checkpoint.radiusMeters}m</small> : <small>找不到此派工區域的啟用打卡點</small>}</div>}<div className="table-card"><h3>今日打卡紀錄</h3>{(['上班', '下班'] as PunchType[]).map(type => { const record = records.find(item => item.date === taipeiToday() && item.punchType === type); return <div className="list-row" key={type}><span><strong>{type}打卡</strong><small>{record?.locationName || '尚未打卡'} {record?.status === 'abnormal' ? '· 異常' : ''}</small></span><time>{record ? new Date(record.timestamp).toLocaleTimeString('zh-TW') : '—'}</time></div> })}</div></section>
}

function CheckpointAdmin() {
  const blank: AttendanceLocation = { id: '', name: '', locationName: '', areaCode: '', areaName: '', latitude: 25.033, longitude: 121.5654, radiusMeters: 150, active: true, note: '', sortOrder: 0 }
  const [points, setPoints] = useState<AttendanceLocation[]>([]); const [editing, setEditing] = useState(blank); const [areaFilter, setAreaFilter] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const load = async () => { setLoading(true); try { setPoints(await listAttendanceLocations()); setError('') } catch (cause) { setError('打卡點讀取失敗，請確認 Firebase 權限與網路') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const save = async () => { if (!editing.locationName || !editing.areaCode || !Number.isFinite(Number(editing.latitude)) || !Number.isFinite(Number(editing.longitude)) || !Number.isFinite(Number(editing.radiusMeters))) return setError('請完整填寫區域、名稱、座標與半徑'); setSaving(true); try { await saveAttendanceLocation({ ...editing, name: editing.locationName }, editing.id || undefined); setEditing(blank); await load() } catch { setError('打卡點儲存失敗') } finally { setSaving(false) } }
  const toggle = async (point: AttendanceLocation) => { try { await saveAttendanceLocation({ ...point, active: !point.active }, point.id); await load() } catch { setError('狀態更新失敗') } }
  const remove = async (point: AttendanceLocation) => { if (!window.confirm(`確定刪除「${point.locationName}」？`)) return; try { await removeAttendanceLocation(point.id); await load() } catch { setError('刪除失敗') } }
  const visible = points.filter(point => !areaFilter || point.areaCode === areaFilter); const areaCounts = points.reduce<Record<string, number>>((all, point) => ({ ...all, [point.areaCode]: (all[point.areaCode] ?? 0) + 1 }), {})
  return <section className="form-card"><p className="eyebrow">GEOFENCE CONFIGURATION · FIRESTORE</p><h1>打卡點管理</h1>{error && <div className="result-card result-warning">{error}</div>}<div className="inline-form"><input placeholder="區域代碼" value={editing.areaCode} onChange={event => setEditing({ ...editing, areaCode: event.target.value })} /><input placeholder="區域名稱" value={editing.areaName} onChange={event => setEditing({ ...editing, areaName: event.target.value })} /><input placeholder="打卡點名稱" value={editing.locationName} onChange={event => setEditing({ ...editing, locationName: event.target.value })} /><input placeholder="緯度" value={editing.latitude} onChange={event => setEditing({ ...editing, latitude: Number(event.target.value) })} /><input placeholder="經度" value={editing.longitude} onChange={event => setEditing({ ...editing, longitude: Number(event.target.value) })} /><input placeholder="半徑（公尺）" value={editing.radiusMeters} onChange={event => setEditing({ ...editing, radiusMeters: Number(event.target.value) })} /><button className="primary" disabled={saving} onClick={() => void save()}><Plus size={16} />{editing.id ? '更新' : '新增'}</button></div><div className="tabs"><button className={!areaFilter ? 'tab active' : 'tab'} onClick={() => setAreaFilter('')}>全部（{points.length}）</button>{Object.entries(areaCounts).map(([area, count]) => <button className={areaFilter === area ? 'tab active' : 'tab'} key={area} onClick={() => setAreaFilter(area)}>{area}（{count}）</button>)}</div><div className="table-card">{loading ? <p className="muted">載入中…</p> : visible.length === 0 ? <p className="muted">尚未建立打卡點。</p> : visible.map(point => <div className="list-row" key={point.id}><span><strong>{point.locationName}</strong><small>{point.areaCode} · {point.latitude}, {point.longitude} · 半徑 {point.radiusMeters}m · {point.active ? '啟用' : '停用'}</small></span><span><button className="text-button" onClick={() => setEditing(point)}>修改</button><button className="text-button" onClick={() => void toggle(point)}>{point.active ? '停用' : '啟用'}</button><button className="icon-button" onClick={() => void remove(point)} aria-label={`刪除${point.locationName}`}><Trash2 size={16} /></button></span></div>)}</div></section>
}

function GeofenceTest() {
  const [points, setPoints] = useState<AttendanceLocation[]>([]); const [selected, setSelected] = useState(''); const [status, setStatus] = useState('尚未測試'); const [result, setResult] = useState<{ position: string; distance: number; accuracy: number; inside: boolean } | null>(null)
  useEffect(() => { void listAttendanceLocations().then(items => { const active = items.filter(item => item.active); setPoints(active); if (active[0]) setSelected(active[0].id) }).catch(() => setStatus('打卡點讀取失敗')) }, [])
  const test = () => { const point = points.find(item => item.id === selected); if (!point) return setStatus('請先選擇啟用中的打卡點'); if (!navigator.geolocation) return setStatus('此瀏覽器不支援定位'); setStatus('定位中…'); navigator.geolocation.getCurrentPosition(value => { const evaluation = evaluateGeofence({ latitude: value.coords.latitude, longitude: value.coords.longitude }, [point]); const distance = evaluation.nearest?.distanceMeters ?? 0; setResult({ position: `${value.coords.latitude.toFixed(6)}, ${value.coords.longitude.toFixed(6)}`, distance, accuracy: value.coords.accuracy, inside: distance <= point.radiusMeters }); setStatus('測試完成') }, error => setStatus(error.code === error.PERMISSION_DENIED ? 'GPS 權限被拒絕，請允許定位後重試' : `定位失敗：${error.message}`), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }) }
  const point = points.find(item => item.id === selected)
  return <section className="form-card"><p className="eyebrow">GEOFENCE DIAGNOSTICS · FIRESTORE</p><h1>電子圍籬測試結果</h1><select value={selected} onChange={event => setSelected(event.target.value)}><option value="">選擇打卡點</option>{points.map(item => <option value={item.id} key={item.id}>{item.areaCode} · {item.locationName}</option>)}</select>{point && <p className="muted">打卡點座標：{point.latitude}, {point.longitude} · 允許半徑：{point.radiusMeters}m</p>}<button className="primary" onClick={test}><LocateFixed size={17} />取得目前位置並測試</button><div className={`result-card ${result?.inside ? 'result-success' : 'result-warning'}`}><strong>{result ? (result.inside ? '範圍內' : '範圍外') : status}</strong>{result && <small>目前座標：{result.position}<br />GPS accuracy：{Math.round(result.accuracy)}m<br />實際距離：{Math.round(result.distance)}m<br />允許半徑：{point?.radiusMeters}m</small>}</div></section>
}

function IntegrationsView() { const items = [['打卡紀錄後端', '尚未串接 Firestore／Cloud Functions', '尚未串接'], ['請假申請與簽核', '目前僅有畫面示意', '尚未串接'], ['預排班儲存', '目前只在畫面中產生草稿', '尚未串接'], ['推播與異常通知', '尚未設定通知服務', '尚未串接'], ['正式電子圍籬驗證', '目前只有瀏覽器定位測試', '測試中']]; return <section className="form-card"><p className="eyebrow">INTEGRATION STATUS</p><h1>尚未串接的部分</h1><div className="table-card">{items.map(([name, detail, state]) => <div className="list-row" key={name}><span><strong>{name}</strong><small>{detail}</small></span><em>{state}</em></div>)}</div></section> }

function ScheduleView({ tab, setTab, data, employeeId }: { tab: string; setTab: (tab: string) => void; data: ScheduleData | null; employeeId: string }) {
  const isMine = tab === 'mine'
  const rows = tab === 'morning' ? data?.morning ?? [] : data?.night ?? []
  const personal = data && [...data.night, ...data.morning].find(row => row.employeeId === employeeId)
  return <><div className="page-intro"><div><p className="eyebrow">SEPTEMBER SCHEDULE · FIRESTORE</p><h1>{isMine ? '我的班表' : tab === 'morning' ? '早班全員班表' : '夜班全員班表'}</h1><p className="muted">{isMine ? '本人的正式班表。' : `Firestore ${tab === 'morning' ? '早班' : '夜班'}資料，共 ${rows.length} 筆。`}</p></div></div><div className="tabs"><button className={isMine ? 'tab active' : 'tab'} onClick={() => setTab('mine')}>我的班表</button><button className={tab === 'morning' ? 'tab active' : 'tab'} onClick={() => setTab('morning')}>早班</button><button className={tab === 'night' ? 'tab active' : 'tab'} onClick={() => setTab('night')}>夜班</button></div>{!data ? <p className="loading">正在載入 9 月班表…</p> : isMine ? <PersonalSchedule row={personal ?? undefined} month={data.month} /> : rows.length ? <ScheduleMatrix rows={rows} days={data.days} /> : <p className="loading">班表資料尚未匯入</p>}</>
}

function PersonalSchedule({ row, month }: { row: ScheduleRow | undefined; month: string }) {
  if (!row) return <p className="loading">找不到本人的來源班表。</p>
  const [year, monthNumber] = month.split('-').map(Number)
  const offset = new Date(year, monthNumber - 1, 1).getDay()
  const count = new Date(year, monthNumber, 0).getDate()
  const labels: Record<string, string> = { 慰: '慰勞', 事: '事假', 病: '病假', 特: '特休', 例: '例假', 休: '休假' }
  return <section className="personal-month"><h2 className="plan-month">{year} 年 {monthNumber} 月</h2><div className="month-grid">{['日','一','二','三','四','五','六'].map(w=><div className="weekday" key={w}>{w}</div>)}{Array.from({length:offset},(_,i)=><div key={'blank'+i} aria-hidden="true" />)}{Array.from({length:count},(_,index)=>{const shift=row.shifts[index] || ''; return <article className={`month-day ${scheduleCellStyle(shift)}`} key={index} aria-label={`${monthNumber}月${index+1}日 ${shift}`}><small>{index+1}</small><strong>{labels[shift] || shift || '—'}</strong></article>})}</div></section>
}

function ScheduleMatrix({ rows, days }: { rows: ScheduleRow[]; days: string[] }) {
  const groups = rows.reduce<{ area: string; people: ScheduleRow[] }[]>((result, row) => {
    const area = scheduleGroup(row)
    const latest = result[result.length - 1]
    if (!latest || latest.area !== area) result.push({ area, people: [row] })
    else latest.people.push(row)
    return result
  }, [])
  return <div className="matrix-wrap"><table className="schedule-matrix"><colgroup><col className="col-title" /><col className="col-id" /><col className="col-name" />{days.map(day => <col className="col-day" key={day} />)}</colgroup><thead><tr><th>職務</th><th>員編</th><th>姓名</th>{days.map((day, index) => <th className={weekdayHeaderStyle(index)} key={day}><span>9月{day}日</span><small>{weekdayAt(index)}</small></th>)}</tr></thead><tbody>{groups.map((group, index) => <Fragment key={`${group.area}-${index}`}><tr className="area-heading"><td colSpan={days.length + 3}><span className="area-label">{group.area}</span></td></tr>{group.people.map(row => <tr key={row.rowId}><td>{row.title || '—'}</td><td>{row.employeeId}</td><td><strong>{row.name}</strong><small className="pinned-role">{row.title}</small></td>{row.shifts.map((shift, dayIndex) => <td className={scheduleCellStyle(shift)} key={dayIndex}>{shift || '—'}</td>)}</tr>)}</Fragment>)}</tbody></table></div>
}

function scheduleGroup(row: ScheduleRow) {
  if (row.title.includes('調度主任') || row.title.includes('調度副主任')) return '單位主官'
  if (row.group) return row.group
  if (row.title.includes('調度監控') || row.title.includes('實習領班')) return '調度監控'
  if (row.area) return `${row.area}區`
  if (row.title.includes('PT')) return '支援人力'
  return '未標示區域'
}

function scheduleCellStyle(shift: string) {
  if (['例', '休', '慰'].includes(shift)) return 'cell-rest'
  if (shift.includes('病') || shift.includes('事') || shift.includes('特') || shift === '假') return 'cell-leave'
  if (shift.includes('國上') || shift.includes('休上')) return 'cell-special'
  return ''
}

function weekdayHeaderStyle(index: number) {
  if (weekdayAt(index) === '六') return 'saturday'
  if (weekdayAt(index) === '日') return 'sunday'
  return ''
}

function weekdayAt(index: number) {
  return weekdays[index % 7]
}

function EmptyNotice() { return <section className="notice-page"><div className="notice-heading"><Megaphone size={25} /><div><p className="eyebrow">NOTICE</p><h1>公告</h1></div></div><article className="notice-image-card"><img src={publicAssetUrl('temporary-notice.png')} alt="獎懲公告" /></article></section> }

function deriveDispatchRecords(schedules: ScheduleRecord[], overrides: DispatchRecord[], areas: AreaMaster[], employeeId?: string): DispatchRecord[] {
  const areaMap = new Map(areas.map(area => [area.areaCode, area]))
  const overrideMap = new Map(overrides.map(record => [`${record.employeeId}|${record.scheduleCode}`, record]))
  const genericMapping = new Map(finalDispatchMapping.filter(item => item.mappingType === 'alias').map(item => [item.scheduleCode, item]))
  const employeeMapping = new Map(finalDispatchMapping.filter(item => item.mappingType === 'employee-specific' && 'employeeId' in item).map(item => [`${item.employeeId}|${item.scheduleCode}|${item.evidenceDate || ''}`, item]))
  const sourceRows = [...sourceSchedule.morning.map(row => ({ ...row, shiftType: 'morning' as const })), ...sourceSchedule.night.map(row => ({ ...row, shiftType: 'night' as const }))]
  const sourceMap = new Map(sourceRows.map(row => [`${row.shiftType}:${row.employeeId}`, row]))
  return schedules.filter(record => (!employeeId || record.employeeId === employeeId) && record.scheduleCode && !isLeave(record.scheduleCode)).map(record => {
    const source = sourceMap.get(`${record.shiftType}:${record.employeeId}`)
    const pseudoRow: ScheduleRow = { rowId: record.id, employeeId: record.employeeId, name: record.employeeName, title: record.title || source?.title || '', group: record.group || source?.group || '', area: record.area || source?.area || '', shifts: [] }
    const evidence = finalDispatchMapping.find(item => item.mappingType === 'employee-specific' && 'employeeId' in item && item.employeeId === record.employeeId && item.evidenceDate === record.date)
    const mapping = evidence || employeeMapping.get(`${record.employeeId}|${record.scheduleCode}|${record.date}`) || genericMapping.get(record.scheduleCode)
    const specialGroup = dispatchSpecialGroup(pseudoRow)
    const areaCode = mapping?.targetAreaCode || (specialGroup ? specialGroup : '')
    const area = areaMap.get(areaCode)
    const base: DispatchRecord = {
      id: `${record.date}-${record.employeeId}-${record.shiftType}`,
      date: record.date,
      employeeId: record.employeeId,
      employeeName: record.employeeName,
      scheduleCode: record.scheduleCode,
      shiftType: record.shiftType,
      areaCode,
      areaName: area?.areaName || (specialGroup || (areaCode ? `${areaCode}區` : '待人工派工')),
      vehicleType: area?.defaultVehicleType || '', vehicleNo: evidence && 'vehicleNo' in evidence ? evidence.vehicleNo || area?.defaultVehicleNo || '' : area?.defaultVehicleNo || '',
      driver: evidence && 'role' in evidence ? (evidence.role === 'driver' ? record.employeeName : '') : (record.title?.includes('PT') ? '' : record.employeeName),
      assistant: evidence && 'role' in evidence ? (evidence.role === 'assistant' ? record.employeeName : '') : '',
      station: evidence && 'role' in evidence ? (evidence.role === 'station' ? record.employeeName : '') : (record.title?.includes('PT') ? (area?.defaultStation || '') : ''),
      workFocus: area?.defaultWorkFocus || '', balanceArea: area?.defaultBalanceArea || '', note: '',
      source: 'scheduleRecords', status: 'active', createdAt: undefined, updatedAt: undefined, modifiedBy: '',
    }
    return { ...base, ...(overrideMap.get(`${record.employeeId}|${record.scheduleCode}`) || {}) }
  }).sort((left, right) => dispatchAreaOrder(left.areaCode) - dispatchAreaOrder(right.areaCode) || left.employeeName.localeCompare(right.employeeName, 'zh-Hant'))
}

function FirestoreDispatchView({ employeeId, isDuty }: { employeeId: string; isDuty: boolean }) {
  const [date, setDate] = useState(taipeiToday); const [records, setRecords] = useState<DispatchRecord[]>([]); const [error, setError] = useState('')
  const load = async () => { try { const [schedules, overrides, areas] = await Promise.all([listScheduleRecords(date), listDispatchRecords(date), listAreaMaster()]); const next = deriveDispatchRecords(schedules, overrides, areas); console.info('[dispatch] derived from scheduleRecords', { date, scheduleCount: schedules.length, overrideCount: overrides.length, count: next.length }); setRecords(next); setError('') } catch (error: unknown) { console.error('[dispatch] load failed', error); setRecords([]); const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''; setError(code === 'permission-denied' ? '派工／班表讀取權限不足' : code === 'failed-precondition' ? '派工查詢缺少 Firestore index' : '派工資料載入失敗') } }
  useEffect(() => { void load() }, [date, employeeId, isDuty])
  const [shift, setShift] = useState<'night' | 'morning'>('night')
  const visible = records.filter(record => record.shiftType === shift)
  const groups = visible.reduce<Record<string, DispatchRecord[]>>((all, record) => ({ ...all, [record.areaCode || '未分區']: [...(all[record.areaCode || '未分區'] || []), record] }), {})
  const orderedGroups = Object.entries(groups).sort(([left], [right]) => dispatchAreaOrder(left) - dispatchAreaOrder(right) || left.localeCompare(right, 'en', { numeric: true }))
  return <><div className="dispatch-toolbar"><label>日期<input type="date" value={date} onChange={event => event.target.value && setDate(event.target.value)} /></label><div className="tabs"><button className={shift === 'night' ? 'tab active' : 'tab'} onClick={() => setShift('night')}>夜班</button><button className={shift === 'morning' ? 'tab active' : 'tab'} onClick={() => setShift('morning')}>早班</button></div></div>{error && <div className="result-card result-warning">{error}</div>}{!records.length && !error ? <p className="loading">此日期尚未匯入班表。</p> : !visible.length ? <p className="loading">此日期沒有{shift === 'night' ? '夜班' : '早班'}派工。</p> : <div className="dispatch-grid">{orderedGroups.map(([area, members]) => { const special = area === '單位主官' || area.includes('監控'); const vehicleRows = Array.from(new Map(members.filter(record => record.vehicleNo).map(record => [record.vehicleNo, record])).values()); return <article className={special ? 'dispatch-card command-card' : 'dispatch-card'} key={area}><header><span>{members[0].areaName || area}</span><small>{shift === 'night' ? '夜班' : '早班'} · {date}</small></header><div className="dispatch-fields">{special ? <><b>人員</b><div>{members.map(record => <span className="person" key={record.id}>{record.employeeName}<small>{record.employeeId} · {record.scheduleCode}</small></span>)}</div></> : <><b>駕駛</b><div>{members.filter(record => record.driver).map(record => <span className="person" key={record.id}>{record.driver}<small>{record.employeeId} · {record.scheduleCode}</small></span>) || '—'}</div><b>隨車</b><div>{members.filter(record => record.assistant).map(record => <span className="person" key={record.id}>{record.assistant}</span>) || '—'}</div><b>駐點</b><div>{members.filter(record => record.station).map(record => <span className="person" key={record.id}>{record.employeeName}<small>{record.station}</small></span>) || '—'}</div><b>車型／車號</b><span>{vehicleRows.map(record => `${record.vehicleType || '—'}／${record.vehicleNo || '—'}`).join('、') || '—'}</span><b>工作重點</b><span>{members[0].workFocus || '—'}</span><b>平衡區域</b><span>{members[0].balanceArea || '—'}</span><b>備註</b><span>{members.map(record => record.note).filter(Boolean).join('、') || '—'}</span></>}</div></article>})}</div>}</>
}

function DispatchAdmin({ employeeId }: { employeeId: string }) {
  const [date, setDate] = useState(taipeiToday); const [area, setArea] = useState(''); const [shift, setShift] = useState(''); const [search, setSearch] = useState(''); const [records, setRecords] = useState<DispatchRecord[]>([]); const [areas, setAreas] = useState<AreaMaster[]>([]); const [editing, setEditing] = useState<DispatchRecord | null>(null); const [draft, setDraft] = useState<Partial<DispatchRecord>>({}); const [error, setError] = useState('')
  const load = async () => { try { const [schedules, overrides, nextAreas] = await Promise.all([listScheduleRecords(date), listDispatchRecords(date), listAreaMaster()]); const nextRecords = deriveDispatchRecords(schedules, overrides, nextAreas); console.info('[dispatchAdmin] loaded', { date, scheduleCount: schedules.length, overrideCount: overrides.length, count: nextRecords.length }); setRecords(nextRecords); setAreas(nextAreas); setError('') } catch (error) { console.error('[dispatchAdmin] load failed', error); const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''; setError(code === 'permission-denied' ? '派工管理權限不足' : code === 'failed-precondition' ? '派工查詢缺少 Firestore index' : '派工資料載入失敗') } }
  useEffect(() => { void load() }, [date])
  const filtered = records.filter(record => (!area || record.areaCode === area) && (!shift || record.scheduleCode.includes(shift)) && (!search || `${record.employeeId} ${record.employeeName}`.toLowerCase().includes(search.toLowerCase())))
  const open = (record: DispatchRecord) => { setEditing(record); setDraft({ ...record }) }
  const setField = (key: keyof DispatchRecord, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const save = async () => { if (!editing) return; const next = { ...draft }; const targetArea = areas.find(item => item.areaCode === next.areaCode); if (next.areaCode && next.areaCode !== editing.areaCode && targetArea && !window.confirm(`是否重新帶入 ${next.areaCode} 預設派工資料？`)) { next.areaCode = editing.areaCode } else if (targetArea && next.areaCode !== editing.areaCode) { Object.assign(next, { vehicleType: targetArea.defaultVehicleType, vehicleNo: targetArea.defaultVehicleNo, station: targetArea.defaultStation, workFocus: targetArea.defaultWorkFocus, balanceArea: targetArea.defaultBalanceArea }) }
    try { await updateDispatchRecord(editing.id, next, employeeId); await writeDispatchAudit(editing.id, editing.date, editing, next, employeeId); setEditing(null); await load() } catch { setError('派工儲存失敗') }
  }
  return <section><div className="page-intro"><div><p className="eyebrow">DISPATCH ADMIN · FIRESTORE</p><h1>派工管理</h1><p className="muted">正式來源：dispatchRecords。修改只影響目前日期。</p></div></div><div className="dispatch-toolbar"><label>日期<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>區域<select value={area} onChange={e => setArea(e.target.value)}><option value="">全部區域</option>{areas.map(item => <option key={item.areaCode} value={item.areaCode}>{item.areaCode} · {item.areaName}</option>)}</select></label><label>班別<select value={shift} onChange={e => setShift(e.target.value)}><option value="">早／夜班</option><option value="早">早班</option><option value="夜">夜班</option></select></label><label>員工搜尋<input placeholder="員編或姓名" value={search} onChange={e => setSearch(e.target.value)} /></label></div>{error && <div className="result-card result-warning">{error}</div>}<div className="dispatch-admin-grid">{filtered.map(record => <article className="dispatch-admin-card" key={record.id} onClick={() => open(record)}><header><strong>{record.areaName || record.areaCode}</strong><span>{record.scheduleCode}</span></header><div><b>{record.employeeName}</b><small>{record.employeeId}</small><p>車型／車號：{record.vehicleType || '—'}／{record.vehicleNo || '—'}</p><p>駕駛：{record.driver || '—'}　隨車：{record.assistant || '—'}</p><p>駐點：{record.station || '—'}</p><p>工作重點：{record.workFocus || '—'}</p><p>平衡區域：{record.balanceArea || '—'}</p><p>備註：{record.note || '—'}</p></div></article>)}</div>{editing && <div className="broadcast-modal-backdrop"><section className="broadcast-modal dispatch-editor" role="dialog"><button className="broadcast-close" onClick={() => setEditing(null)}><X size={18} /></button><p className="eyebrow">編輯派工 · {editing.date}</p><h2>{editing.employeeName} · {editing.employeeId}</h2>{(['areaCode','vehicleType','vehicleNo','driver','assistant','station','workFocus','balanceArea','note'] as const).map(key => key === 'areaCode' ? <label key={key}>區域<select value={String(draft[key] || '')} onChange={e => setField(key, e.target.value)}>{areas.map(item => <option key={item.areaCode} value={item.areaCode}>{item.areaCode} · {item.areaName}</option>)}</select></label> : <label key={key}>{({ vehicleType:'車型', vehicleNo:'車號', driver:'駕駛', assistant:'隨車', station:'駐點', workFocus:'工作重點', balanceArea:'平衡區域', note:'備註' } as Record<string,string>)[key]}<input value={String(draft[key] || '')} onChange={e => setField(key, e.target.value)} /></label>)}<button className="primary full" onClick={() => void save()}>儲存修改</button></section></div>}</section>
}

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (type: string) => parts.find(p => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function DispatchView({ data }: { data: ScheduleData | null }) {
  const [date, setDate] = useState(taipeiToday)
  const day = Number(date.slice(8))
  const sourceMonth = data?.month?.replace('/', '-').slice(0, 7) || '2026-09'
  const [shift, setShift] = useState<'night' | 'morning'>('night')
  const rows = shift === 'night' ? data?.night ?? [] : data?.morning ?? []
  const people = (date.slice(0, 7) === sourceMonth ? rows : []).map(row => ({ row, code: row.shifts[day - 1], area: dispatchArea(row.shifts[day - 1]) || dispatchSpecialGroup(row) })).filter(item => item.code && !isLeave(item.code) && item.area)
  const groups = people.reduce<Record<string, { row: ScheduleRow; code: string; area: string }[]>>((result, item) => {
    result[item.area] = [...(result[item.area] ?? []), item]
    return result
  }, {})
  const orderedGroups = Object.entries(groups).sort(([left], [right]) => dispatchAreaOrder(left) - dispatchAreaOrder(right) || left.localeCompare(right, 'en', { numeric: true }))
  return <><div className="dispatch-toolbar"><label>日期<input type="date" value={date} onChange={event => event.target.value && setDate(event.target.value)} /></label><div className="tabs"><button className={shift === 'night' ? 'tab active' : 'tab'} onClick={() => setShift('night')}>夜班</button><button className={shift === 'morning' ? 'tab active' : 'tab'} onClick={() => setShift('morning')}>早班</button></div></div>{!data ? <p className="loading">正在載入班表資料…</p> : date.slice(0, 7) !== sourceMonth ? <p className="loading">此月份尚未匯入班表</p> : <div className="dispatch-grid">{orderedGroups.map(([area, members]) => { const special = area === '單位主官' || area.includes('監控'); const drivers = members.filter(member => !member.row.title.includes('PT')); const stations = members.filter(member => member.row.title.includes('PT')); return <article className={special ? 'dispatch-card command-card' : 'dispatch-card'} key={area}><header><span>{area.endsWith('區') || area === '單位主官' || area.includes('監控') ? area : `${area}區`}</span><small>{shift === 'night' ? '夜班' : '早班'} · {Number(date.slice(5, 7))}/{day}</small></header><div className="dispatch-fields">{special ? <><b>人員</b><div>{members.map(member => <span className="person" key={member.row.rowId}>{member.row.name}<small>{member.code}</small></span>)}</div></> : <><b>駕駛</b><div>{drivers.length ? drivers.map(member => <span className="person" key={member.row.rowId}>{member.row.name}<small>{member.code}</small></span>) : '—'}</div><b>駐點</b><div>{stations.length ? stations.map(member => <span className="person" key={member.row.rowId}>{member.row.name}<small>{member.code}</small></span>) : '—'}</div><b>工作重點</b><span>{dispatchFocus(area)}</span><b>平衡區域</b><span>無</span></>}</div></article>})}</div>}</>
}

function isLeave(shift: string) { return ['例', '休', '慰'].includes(shift) || shift.includes('病') || shift.includes('事') || shift.includes('特') || shift === '假' }

function dispatchArea(shift: string) {
  const areas = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'D1', 'D2', 'D3', 'E1', 'E2', 'F1', 'F2', 'G1', 'G2', 'H1', 'H2', 'I1', 'I2', 'I3', 'J1', 'J2', 'K1', 'K2', 'K3', 'K4', 'L1', 'L2', 'L3', 'L4', 'M2', 'N1', 'N2', 'N3', 'O1', 'O2', 'O3', 'O4', 'P1', 'P2', 'T1', 'T2', 'U', 'V', 'W1', 'W2', 'W3', 'X1', 'X2', 'C', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T']
  return areas.find(area => shift.includes(area)) ?? ''
}

function dispatchFocus(area: string) {
  const master: Record<string, string> = {
    O1: '無',
    O2: '禁止進入22:00-06:00港德攤集中區（中正路236巷）',
    O4: '德光園光街口00:00後正職勿前往作業；00:00後PT勿前往作業',
    E1: '大業大同街口站4車、中和橋455巷11弄1車（6點拍照列管週期）\n捷運新北投站2車＋2對向出口1車（6點拍照列管週期）',
    E2: '中山天母路口1車（6點拍照列管週期）\n捷運石牌站2號（6點8成滿）',
    E: '裕民一路3巷（6點9成滿）\n溫泉路68巷6弄（溫泉路81號備14台）',
    F1: 'F1雙悠', F2: 'F2汐止',
    H: '00點-07點勿前往捷運大直街94巷作業', H2: '00點-07點勿前往福林路100巷77弄口作業',
    K1: '三重國中22點-06點勿前往作業\n光明市場早上6點備20台',
    K2: '小夜車支援三和國中站2號（列管週期）',
    P1: '22:00-07:00 禁止景華街128巷作業\n景興國中請於06:00-06:30之間拉空站（開學期）',
    P2: '萬芳出租國宅偏30 早上拍照',
    T1: '06:00前將臺鐵鳳鳴站、臺鐵鳳鳴站（鶯歌路）兩站站上拉空',
    V1: '早上6點普龍青站上8成滿，備輪20台', V2: '早上6點中興復興路口站上8成滿，備輪10台',
  }
  return master[area] ?? '無'
}

function dispatchSpecialGroup(row: ScheduleRow) {
  if (row.title.includes('調度主任') || row.title.includes('調度副主任')) return '單位主官'
  if (row.group.includes('監控') || row.title.includes('調度監控') || row.title.includes('實習領班')) return '調度監控'
  return ''
}

function dispatchAreaOrder(area: string) {
  if (area === '單位主官') return -2
  if (area.includes('監控')) return -1
  return 0
}

function PreSchedule({ onSave }: { onSave: () => void }) {
  const [month] = useState(() => { const today = taipeiToday(); return new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1) })
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const offset = month.getDay()
  const [plan, setPlan] = useState<string[]>(() => Array(days).fill(''))
  const [activeDay, setActiveDay] = useState(0)
  const [tool, setTool] = useState('上班')
  const choices = ['上班', '休', '休上', '例', '慰', '病', '事', '特']
  const applyToDay = (index: number) => { setActiveDay(index); setPlan(current => current.map((value, day) => day === index ? tool : value)) }
  const checks = plan.map((_, index) => index).filter(index => (offset + index) % 7 === 0 && index + 7 <= plan.length).map(start => {
    const week = plan.slice(start, start + 7)
    const hasRegularDay = week.includes('例')
    const hasRestDay = week.some(value => value === '休' || value.includes('休上'))
    const hasWorkDay = week.includes('上班')
    return { start: start + 1, end: start + 7, ok: hasRegularDay && hasRestDay && hasWorkDay }
  })
  const longestWorkRun = plan.reduce((state, value) => value === '上班' ? { current: state.current + 1, longest: Math.max(state.longest, state.current + 1) } : { current: 0, longest: state.longest }, { current: 0, longest: 0 }).longest
  const hasContinuousWorkError = longestWorkRun > 5
  const canSubmit = plan.every(Boolean) && checks.every(check => check.ok) && !hasContinuousWorkError
  return <section className="pre-card"><h2 className="plan-month">{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2><div className="plan-tools"><div>{choices.map(choice => <button key={choice} aria-pressed={tool === choice} onClick={() => setTool(choice)} className={tool === choice ? 'choice active' : 'choice'}>{choice}</button>)}<button className={tool === '' ? 'choice active' : 'choice'} onClick={() => setTool('')}>清除</button></div></div><div className="month-grid">{['日','一','二','三','四','五','六'].map(w => <div className="weekday" key={w}>{w}</div>)}{Array.from({length:offset},(_,i)=><div aria-hidden="true" key={'blank'+i} />)}{plan.map((shift,index)=><button aria-label={`${month.getMonth()+1}月${index+1}日 ${shift || '未排'}`} key={index} onClick={()=>applyToDay(index)} className={`month-day ${activeDay===index?'selected':''} ${scheduleCellStyle(shift)}`}><small>{index+1}</small><strong>{shift || '—'}</strong></button>)}</div><label>備註<textarea placeholder="排班備註" /></label><button className="primary" disabled={!canSubmit} onClick={onSave}>儲存預排班</button></section>
}

function LeaveView({ onAction }: { onAction: (text: string) => void }) { const leaves = [['特休', '15 天', '0 天', '0 天'], ['病假', '30 天', '0 天', '0 天'], ['事假', '14 天', '0 天', '0 天']]; return <><div className="leave-actions"><button className="primary" onClick={() => onAction('已開啟請假申請（Beta 示意）')}>我要請假</button></div><div className="leave-table"><div className="leave-row head"><span>假別</span><span>可用／額度</span><span>已使用</span><span>簽核中</span></div>{leaves.map(row => <div className="leave-row" key={row[0]}>{row.map((cell, i) => <span key={`${cell}-${i}`}>{cell}</span>)}</div>)}</div></> }

function ProfileView({ employee }: { employee: Employee }) { return <article className="form-card profile-card"><p className="eyebrow">PROFILE</p><h1>個人資料</h1><dl><div><dt>姓名</dt><dd>{employee.name}</dd></div><div><dt>員工編號</dt><dd>{employee.employeeId}</dd></div><div><dt>職稱</dt><dd>{employee.title}</dd></div><div><dt>到職日</dt><dd>{employee.hireDate}</dd></div><div><dt>帳號狀態</dt><dd>{employee.active ? '啟用' : '停用'}</dd></div></dl></article> }

function ChangePassword({ employee, onDone }: { employee: Employee; onDone: () => Promise<void> }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setError('')
    if (newPassword.length < 8) return setError('新密碼至少需要 8 個字元')
    if (newPassword.toUpperCase() === employee.employeeId) return setError('新密碼不可與員工編號相同')
    if (newPassword !== confirmation) return setError('兩次輸入的新密碼不一致')
    setSaving(true)
    try {
      const changePassword = httpsCallable<{ newPassword: string }, { success: boolean }>(functions, 'changeOwnPassword')
      await changePassword({ newPassword })
      await onDone()
    } catch (cause: unknown) {
      setError(functionMessage(cause, '密碼更新失敗，請稍後再試'))
    } finally {
      setSaving(false)
    }
  }
  return <main className="login-page"><section className="login-card password-card"><KeyRound className="password-icon" size={36} /><p className="eyebrow">SECURITY REQUIRED</p><h1>請先設定新密碼</h1><p className="muted">首次登入或管理員重設後，必須修改密碼才能進入工作台。</p><label>新密碼<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><label>再次輸入新密碼<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} onKeyDown={event => event.key === 'Enter' && void submit()} /></label><button className="primary full" disabled={saving} onClick={() => void submit()}>{saving ? '更新中…' : '更新密碼並重新登入'}</button>{error && <p className="error">{error}</p>}<button className="text-button" onClick={() => void signOut(auth)}>登出</button></section></main>
}

function AdminEmployees({ notify }: { notify: (text: string) => void }) {
  const empty: Employee = { employeeId: '', name: '', title: '', role: 'employee', hireDate: new Date().toISOString().slice(0, 10), active: true, mustChangePassword: true }
  const [employees, setEmployees] = useState<Employee[]>([])
  const [editing, setEditing] = useState<Employee>(empty)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const list = httpsCallable<undefined, { employees: Employee[] }>(functions, 'adminListEmployees')
      setEmployees((await list()).data.employees)
    } catch (cause) {
      notify(functionMessage(cause, '員工主檔載入失敗'))
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const save = async () => {
    setSaving(true)
    try {
      const call = httpsCallable<Employee, { employeeId: string }>(functions, 'adminSaveEmployee')
      await call(editing)
      notify(`${editing.employeeId || '新員工'}已儲存`)
      setEditing(empty)
      await load()
    } catch (cause) { notify(functionMessage(cause, '員工資料儲存失敗')) }
    finally { setSaving(false) }
  }
  const toggle = async (employee: Employee) => {
    const action = employee.active ? '停用' : '啟用'
    if (!window.confirm(`確定要${action} ${employee.employeeId} ${employee.name}？`)) return
    try {
      const call = httpsCallable<{ employeeId: string; active: boolean }, { success: boolean }>(functions, 'adminSetActive')
      await call({ employeeId: employee.employeeId, active: !employee.active })
      notify(`已${action}${employee.name}的帳號`)
      await load()
    } catch (cause) { notify(functionMessage(cause, `${action}失敗`)) }
  }
  const reset = async (employee: Employee) => {
    if (!window.confirm(`確定強制重設 ${employee.employeeId} ${employee.name} 的密碼？\n重設後暫時密碼為員工編號，且下次登入必須修改。`)) return
    try {
      const call = httpsCallable<{ employeeId: string }, { success: boolean }>(functions, 'adminResetPassword')
      await call({ employeeId: employee.employeeId })
      notify(`已重設${employee.name}的密碼`)
      await load()
    } catch (cause) { notify(functionMessage(cause, '密碼重設失敗')) }
  }
  return <><section className="admin-head"><div><p className="eyebrow">ADMINISTRATION</p><h1>員工主檔</h1><p className="muted">密碼由 Firebase Authentication 驗證，管理員無法查看目前密碼。</p></div><button className="primary" onClick={() => setEditing(empty)}>＋ 新增員工</button></section><section className="employee-editor"><h2>{editing.employeeId ? `編輯 ${editing.employeeId}` : '新增員工'}</h2><div className="employee-form"><label>員工編號<input disabled={employees.some(item => item.employeeId === editing.employeeId)} value={editing.employeeId} onChange={event => setEditing(value => ({ ...value, employeeId: event.target.value.toUpperCase() }))} /></label><label>姓名<input value={editing.name} onChange={event => setEditing(value => ({ ...value, name: event.target.value }))} /></label><label>職稱<input value={editing.title} onChange={event => setEditing(value => ({ ...value, title: event.target.value }))} /></label><label>到職日<input type="date" value={editing.hireDate} onChange={event => setEditing(value => ({ ...value, hireDate: event.target.value }))} /></label><label>角色<select value={editing.role} onChange={event => setEditing(value => ({ ...value, role: event.target.value as Employee['role'] }))}><option value="employee">一般員工</option><option value="duty">監控人員</option><option value="admin">管理員</option></select></label><label className="check-label"><input type="checkbox" checked={editing.active} onChange={event => setEditing(value => ({ ...value, active: event.target.checked }))} />啟用帳號</label></div><button className="primary" disabled={saving || !editing.employeeId || !editing.name || !editing.title} onClick={() => void save()}>{saving ? '儲存中…' : '儲存員工資料'}</button></section>{loading ? <p className="loading">正在載入員工主檔…</p> : <div className="employee-table"><div className="employee-row employee-head-row"><span>員編／姓名</span><span>職稱</span><span>角色</span><span>狀態</span><span>操作</span></div>{employees.map(employee => <div className="employee-row" key={employee.employeeId}><span><strong>{employee.employeeId}</strong><small>{employee.name}</small></span><span>{employee.title}</span><span>{employee.role === 'admin' ? '管理員' : employee.role === 'duty' ? '監控' : '員工'}</span><span className={employee.active ? 'account-active' : 'account-disabled'}>{employee.active ? (employee.mustChangePassword ? '啟用／待改密碼' : '啟用') : '停用'}</span><span className="employee-actions"><button onClick={() => setEditing(employee)}>編輯</button><button onClick={() => void reset(employee)}>重設密碼</button><button className={employee.active ? 'danger' : ''} onClick={() => void toggle(employee)}>{employee.active ? '停用' : '啟用'}</button></span></div>)}</div>}</>
}

function functionMessage(cause: unknown, fallback: string) {
  if (typeof cause === 'object' && cause && 'message' in cause) {
    const message = String(cause.message).replace(/^Firebase:\s*/, '').replace(/\s*\([^)]*\)\.?$/, '')
    if (message) return message
  }
  return fallback
}
