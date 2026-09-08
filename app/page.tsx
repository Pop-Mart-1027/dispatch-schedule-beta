'use client'

import './matrix.css'
import './area-fix.css'
import './dispatch.css'
import './youbike-theme.css'
import './mobile-nav.css'
import { Fragment, useEffect, useState } from 'react'
import { CalendarDays, ChevronRight, ClipboardList, ClipboardPlus, Clock3, Coffee, LogOut, Megaphone, Menu, UserRound, X } from 'lucide-react'

type ScheduleRow = { rowId: string; employeeId: string; name: string; title: string; group: string; area: string; shifts: string[] }
type ScheduleData = { month: string; days: string[]; morning: ScheduleRow[]; night: ScheduleRow[] }
const weekdays = ['二', '三', '四', '五', '六', '日', '一']
const adminEmployeeIds = new Set(['B0957'])

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [account, setAccount] = useState('96504')
  const [password, setPassword] = useState('96504')
  const [currentUser, setCurrentUser] = useState<{ name: string; role: 'employee' | 'admin' }>({ name: '涂佑葦', role: 'employee' })
  const [page, setPage] = useState('home')
  const [scheduleTab, setScheduleTab] = useState('mine')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)
  const notify = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 2500) }
  const signIn = () => {
    const person = scheduleData && [...scheduleData.morning, ...scheduleData.night].find(row => row.employeeId === account)
    if (person && password === account) { setCurrentUser({ name: person.name, role: adminEmployeeIds.has(account) ? 'admin' : 'employee' }); setLoggedIn(true) }
    else notify(scheduleData ? '員編不存在或密碼錯誤' : '正在載入員工名冊，請稍候再登入')
  }

  useEffect(() => {
    fetch('/september-schedules.json')
      .then(response => response.json())
      .then((data: ScheduleData) => setScheduleData(data))
      .catch(() => notify('班表來源載入失敗，請重新整理頁面'))
  }, [])

  if (!loggedIn) return <main className="login-page"><section className="login-card"><div className="brand-mark">調</div><p className="eyebrow">YOUBIKE DISPATCH BETA</p><h1>調度組排班</h1><p className="muted">請使用本人員工編號登入。</p><label>員工編號<input value={account} onChange={e => setAccount(e.target.value)} /></label><label>密碼<input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()} /></label><button className="primary full" onClick={signIn}>登入工作台 <ChevronRight size={18} /></button><small>Beta 初始密碼為本人員工編號。</small>{notice && <p className="error">{notice}</p>}</section></main>

  const titles: Record<string, string> = { home: '工作總覽', notice: '公告', schedule: '我的班表', dispatch: '派工單', pre: '預排班', leave: '假勤／特休', profile: '個人資料' }
  const go = (target: string) => { setPage(target); setMenuOpen(false) }
  return <div className="app-shell">{menuOpen && <button className="mobile-backdrop" aria-label="關閉選單" onClick={() => setMenuOpen(false)} />}<aside className={menuOpen ? 'sidebar open' : 'sidebar'}><div className="logo"><span>調</span><div><strong>調度工作台</strong><small>DISPATCH BETA</small></div><button className="drawer-close" aria-label="關閉選單" onClick={() => setMenuOpen(false)}><X size={20} /></button></div><nav><Nav label="工作總覽" active={page === 'home'} icon={<Coffee size={18} />} onClick={() => go('home')} /><Nav label="公告" active={page === 'notice'} icon={<Megaphone size={18} />} onClick={() => go('notice')} /><Nav label="我的班表" active={page === 'schedule'} icon={<CalendarDays size={18} />} onClick={() => go('schedule')} /><Nav label="派工單" active={page === 'dispatch'} icon={<ClipboardList size={18} />} onClick={() => go('dispatch')} /><Nav label="預排班" active={page === 'pre'} icon={<Clock3 size={18} />} onClick={() => go('pre')} /><Nav label="假勤／特休" active={page === 'leave'} icon={<ClipboardPlus size={18} />} onClick={() => go('leave')} /><Nav label="個人資料" active={page === 'profile'} icon={<UserRound size={18} />} onClick={() => go('profile')} /></nav><button className="logout" onClick={() => setLoggedIn(false)}><LogOut size={17} />登出</button></aside><main className="workspace"><header className="topbar"><button className="menu-button" aria-label="開啟選單" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><div><p className="eyebrow">2026 年 9 月</p><h2>{titles[page]}</h2></div><div className="profile-chip"><b>{currentUser.name[0]}</b><span>{currentUser.name}<small>{account} · {currentUser.role === 'admin' ? '管理員' : '調度專員'}</small></span></div></header><section className="content">{page === 'home' && <HomeView onAction={notify} />}{page === 'notice' && <EmptyNotice />}{page === 'schedule' && <ScheduleView tab={scheduleTab} setTab={setScheduleTab} data={scheduleData} />}{page === 'dispatch' && <DispatchView data={scheduleData} />}{page === 'pre' && <PreSchedule onSave={() => notify('預排班已儲存為草稿')} />}{page === 'leave' && <LeaveView onAction={notify} />}{page === 'profile' && <ProfileView />}</section></main>{notice && <div className="toast">✓ {notice}</div>}</div>
}

function Nav({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) { return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span></button> }

function HomeView({ onAction }: { onAction: (text: string) => void }) { return <><section className="welcome"><div><p className="eyebrow">WELCOME BACK</p><h1>早安，涂佑葦。</h1><p className="muted">今天是 9 月 8 日，早班 O1。</p></div><div className="today-badge"><small>今日班別</small><strong>O1</strong></div></section><section className="quick-section"><div><p className="eyebrow">QUICK ACTIONS</p><h2>快速選單</h2></div><div className="quick-grid"><button className="quick-card" onClick={() => onAction('已完成上班打卡（Beta 示意）')}><span className="quick-icon start">↑</span><strong>上班打卡</strong><small>記錄今日上班時間</small></button><button className="quick-card" onClick={() => onAction('已完成下班打卡（Beta 示意）')}><span className="quick-icon end">↓</span><strong>下班打卡</strong><small>記錄今日下班時間</small></button><button className="quick-card" onClick={() => onAction('已開啟請假申請（Beta 示意）')}><span className="quick-icon leave">＋</span><strong>我要請假</strong><small>病假、事假與特休申請</small></button></div></section></> }

function ScheduleView({ tab, setTab, data }: { tab: string; setTab: (tab: string) => void; data: ScheduleData | null }) {
  const isMine = tab === 'mine'
  const rows = tab === 'morning' ? data?.morning ?? [] : data?.night ?? []
  const personal = data?.night.find(row => row.employeeId === '96504')
  return <><div className="page-intro"><div><p className="eyebrow">SEPTEMBER SCHEDULE · EXCEL SOURCE</p><h1>{isMine ? '我的班表' : tab === 'morning' ? '早班全員班表' : '夜班全員班表'}</h1><p className="muted">{isMine ? '直接帶入 9月夜班中員編 96504 的 9/1 至 9/30 班別。' : `直接帶入 Excel「${tab === 'morning' ? '9月日班' : '9月夜班'}」所有有效人員班表，共 ${rows.length} 筆。`}</p></div></div><div className="tabs"><button className={isMine ? 'tab active' : 'tab'} onClick={() => setTab('mine')}>我的班表</button><button className={tab === 'morning' ? 'tab active' : 'tab'} onClick={() => setTab('morning')}>早班</button><button className={tab === 'night' ? 'tab active' : 'tab'} onClick={() => setTab('night')}>夜班</button></div>{!data ? <p className="loading">正在載入 9 月 Excel 班表…</p> : isMine ? <PersonalSchedule row={personal} /> : <ScheduleMatrix rows={rows} days={data.days} />}</>
}

function PersonalSchedule({ row }: { row: ScheduleRow | undefined }) {
  if (!row) return <p className="loading">找不到員編 96504 的來源班表。</p>
  return <div className="calendar">{row.shifts.map((shift, index) => <article className={`day-card work ${scheduleCellStyle(shift)}`} key={index}><small>9月{index + 1}日 · 週{weekdayAt(index)}</small><strong>{shift || '—'}</strong></article>)}</div>
}

function ScheduleMatrix({ rows, days }: { rows: ScheduleRow[]; days: string[] }) {
  const groups = rows.reduce<{ area: string; people: ScheduleRow[] }[]>((result, row) => {
    const area = scheduleGroup(row)
    const latest = result[result.length - 1]
    if (!latest || latest.area !== area) result.push({ area, people: [row] })
    else latest.people.push(row)
    return result
  }, [])
  return <div className="matrix-wrap"><table className="schedule-matrix"><colgroup><col className="col-title" /><col className="col-id" /><col className="col-name" />{days.map(day => <col className="col-day" key={day} />)}</colgroup><thead><tr><th>職務</th><th>員編</th><th>姓名</th>{days.map((day, index) => <th className={weekdayHeaderStyle(index)} key={day}><span>9月{day}日</span><small>{weekdayAt(index)}</small></th>)}</tr></thead><tbody>{groups.map((group, index) => <Fragment key={`${group.area}-${index}`}><tr className="area-heading"><td colSpan={days.length + 3}>{group.area}</td></tr>{group.people.map(row => <tr key={row.rowId}><td>{row.title || '—'}</td><td>{row.employeeId}</td><td><strong>{row.name}</strong></td>{row.shifts.map((shift, dayIndex) => <td className={scheduleCellStyle(shift)} key={dayIndex}>{shift || '—'}</td>)}</tr>)}</Fragment>)}</tbody></table></div>
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

function EmptyNotice() { return <section className="notice-page"><div className="notice-heading"><Megaphone size={25} /><div><p className="eyebrow">NOTICE</p><h1>公告</h1></div></div><article className="notice-image-card"><img src="/temporary-notice.png" alt="獎懲公告" /></article></section> }

function DispatchView({ data }: { data: ScheduleData | null }) {
  const [day, setDay] = useState(7)
  const [shift, setShift] = useState<'night' | 'morning'>('night')
  const rows = shift === 'night' ? data?.night ?? [] : data?.morning ?? []
  const people = rows.map(row => ({ row, code: row.shifts[day - 1], area: dispatchArea(row.shifts[day - 1]) || dispatchSpecialGroup(row) })).filter(item => item.code && !isLeave(item.code) && item.area)
  const groups = people.reduce<Record<string, { row: ScheduleRow; code: string; area: string }[]>>((result, item) => {
    result[item.area] = [...(result[item.area] ?? []), item]
    return result
  }, {})
  const orderedGroups = Object.entries(groups).sort(([left], [right]) => dispatchAreaOrder(left) - dispatchAreaOrder(right) || left.localeCompare(right, 'en', { numeric: true }))
  return <><div className="page-intro"><div><p className="eyebrow">DISPATCH ORDER · SCHEDULE SOURCE</p><h1>分區派工單</h1><p className="muted">僅帶入當日實際上班且可辨識區域的班別；例休與各類請假不列入派工人員。</p></div><span className="status">唯讀</span></div><div className="dispatch-toolbar"><label>日期<select value={day} onChange={event => setDay(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => <option key={index} value={index + 1}>2026/9/{index + 1}（週{weekdayAt(index)}）</option>)}</select></label><div className="tabs"><button className={shift === 'night' ? 'tab active' : 'tab'} onClick={() => setShift('night')}>夜班</button><button className={shift === 'morning' ? 'tab active' : 'tab'} onClick={() => setShift('morning')}>早班</button></div></div>{!data ? <p className="loading">正在載入班表資料…</p> : <div className="dispatch-grid">{orderedGroups.map(([area, members]) => { const special = area === '單位主官' || area.includes('監控'); const drivers = members.filter(member => !member.row.title.includes('PT')); const stations = members.filter(member => member.row.title.includes('PT')); return <article className={special ? 'dispatch-card command-card' : 'dispatch-card'} key={area}><header><span>{area.endsWith('區') || area === '單位主官' || area.includes('監控') ? area : `${area}區`}</span><small>{shift === 'night' ? '夜班' : '早班'} · 9/{day}</small></header><div className="dispatch-fields">{special ? <><b>人員</b><div>{members.map(member => <span className="person" key={member.row.rowId}>{member.row.name}<small>{member.code}</small></span>)}</div></> : <><b>駕駛</b><div>{drivers.length ? drivers.map(member => <span className="person" key={member.row.rowId}>{member.row.name}<small>{member.code}</small></span>) : '—'}</div><b>駐點</b><div>{stations.length ? stations.map(member => <span className="person" key={member.row.rowId}>{member.row.name}<small>{member.code}</small></span>) : '—'}</div><b>工作重點</b><span>{dispatchFocus(area)}</span><b>平衡區域</b><span>無</span></>}</div></article>})}</div>}</>
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
  const [plan, setPlan] = useState<string[]>(Array(30).fill(''))
  const [activeDay, setActiveDay] = useState(0)
  const [tool, setTool] = useState('上班')
  const choices = ['上班', '休', '休上', '例', '慰', '病', '事', '特']
  const applyToDay = (index: number) => { setActiveDay(index); setPlan(current => current.map((value, day) => day === index ? tool : value)) }
  const checks = plan.map((_, index) => index).filter(index => weekdayAt(2 + index) === '日' && index + 7 <= plan.length).map(start => {
    const week = plan.slice(start, start + 7)
    const hasRegularDay = week.includes('例')
    const hasRestDay = week.some(value => value === '休' || value.includes('休上'))
    const hasWorkDay = week.includes('上班')
    return { start: start + 1, end: start + 7, ok: hasRegularDay && hasRestDay && hasWorkDay }
  })
  const longestWorkRun = plan.reduce((state, value) => value === '上班' ? { current: state.current + 1, longest: Math.max(state.longest, state.current + 1) } : { current: 0, longest: state.longest }, { current: 0, longest: 0 }).longest
  const hasContinuousWorkError = longestWorkRun > 5
  const canSubmit = plan.every(Boolean) && checks.every(check => check.ok) && !hasContinuousWorkError
  return <><div className="page-intro"><div><p className="eyebrow">NEXT MONTH PLANNING</p><h1>預排班</h1><p className="muted">直接點日期即標為上班；先選上方類型後，再點日期可填休假或請假。</p></div><span className="status open">開放中</span></div><section className="pre-card"><div className="form-head"><div><h2>10 月預排班</h2><p>連續排班不得超過 5 天；每週日到週六必須安排 1 個例與 1 個休／休上。</p></div><span className="status">草稿</span></div><div className="plan-tools"><span>目前工具：<b>{tool}</b>（點選日期套用）</span><div>{choices.map(choice => <button key={choice} onClick={() => setTool(choice)} className={tool === choice ? 'choice active' : 'choice'}>{choice}</button>)}<button className="choice" onClick={() => setTool('')}>清除</button></div></div><div className="calendar pre-calendar">{plan.map((shift, index) => <button key={index} onClick={() => applyToDay(index)} className={`day-card ${activeDay === index ? 'selected' : ''} ${scheduleCellStyle(shift)}`}><small>10/{index + 1} · 週{weekdayAt(2 + index)}</small><strong>{shift || '未排'}</strong><span>{activeDay === index ? '已選取' : '點選套用'}</span></button>)}</div><label>備註<textarea placeholder="可填寫個人排班偏好或需協調事項" /></label><button className="primary" disabled={!canSubmit} onClick={onSave}>{canSubmit ? '儲存預排班' : '請完成每日設定與日到六一例一休檢查'}</button></section></>
}

function LeaveView({ onAction }: { onAction: (text: string) => void }) { const leaves = [['特休', '15 天', '0 天', '0 天'], ['病假', '30 天', '0 天', '0 天'], ['事假', '14 天', '0 天', '0 天']]; return <><div className="page-intro"><div><p className="eyebrow">LEAVE & ATTENDANCE</p><h1>假勤／特休</h1><p className="muted">查看假別餘額與使用狀態。</p></div><button className="primary" onClick={() => onAction('已開啟請假申請（Beta 示意）')}>我要請假</button></div><div className="leave-table"><div className="leave-row head"><span>假別</span><span>可用／額度</span><span>已使用</span><span>簽核中</span></div>{leaves.map(row => <div className="leave-row" key={row[0]}>{row.map((cell, i) => <span key={`${cell}-${i}`}>{cell}</span>)}</div>)}</div></> }

function ProfileView() { return <article className="form-card profile-card"><p className="eyebrow">PROFILE</p><h1>個人資料</h1><dl><div><dt>姓名</dt><dd>涂佑葦</dd></div><div><dt>員工編號</dt><dd>96504</dd></div><div><dt>職稱</dt><dd>調度專員</dd></div><div><dt>到職日</dt><dd>2016/08/15</dd></div><div><dt>年資</dt><dd>10 年 1 月</dd></div></dl></article> }
