'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  LogOut,
  Megaphone,
  Radio,
  Settings,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { db, functions } from '../lib/firebase';
import {
  listDispatchBlocks,
  updateDispatchBlock,
  writeDispatchBlockAudit,
  type DispatchBlock,
  type DispatchBlockEditable,
  type DispatchBlockPerson,
} from '../lib/dispatch-blocks-firestore';
import {
  listMonthScheduleRecords,
  listScheduleRecords,
  type ScheduleRecord,
} from '../lib/schedule-firestore';
import type { Broadcast } from '../lib/broadcasts';

type BackendRole = 'duty' | 'admin';
type Page =
  | 'dashboard'
  | 'dispatch'
  | 'schedule'
  | 'broadcasts'
  | 'employees'
  | 'pre-settings'
  | 'system'
  | 'leave';
type EmployeeRecord = {
  employeeId: string;
  name: string;
  title: string;
  hireDate: string;
  role: 'employee' | 'duty' | 'admin';
  active: boolean;
  mustChangePassword: boolean;
};
type Person = { employeeId: string; name: string };
type DutyStaff = {
  directors: string[];
  deputyDirectors: string[];
  taipei: string[];
  newTaipei: string[];
};

const todayTaipei = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(
    new Date(),
  );
const isLeave = (code: string) =>
  ['例', '休', '慰'].includes(code) || /假|病|事|特/.test(code);
const peopleCount = (block: DispatchBlock) =>
  block.drivers.length + block.stations.length + block.assistants.length;
const peopleNames = (people: DispatchBlockPerson[]) =>
  people
    .map((person) => person.employeeName)
    .filter(Boolean)
    .join('、') || '—';
const timestampDate = (value: unknown) =>
  value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate()
    : null;
const datetimeValue = (value: unknown) =>
  timestampDate(value)?.toISOString().slice(0, 16) ?? '';
const displayTime = (value: unknown) =>
  timestampDate(value)?.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) ??
  '—';

function deriveDuty(
  records: ScheduleRecord[],
  employees: EmployeeRecord[],
  shift: 'morning' | 'night',
): DutyStaff {
  const profiles = new Map(
    employees.map((employee) => [employee.employeeId, employee]),
  );
  const result: DutyStaff = {
    directors: [],
    deputyDirectors: [],
    taipei: [],
    newTaipei: [],
  };
  records
    .filter(
      (record) => record.shiftType === shift && !isLeave(record.scheduleCode),
    )
    .forEach((record) => {
      const employee = profiles.get(record.employeeId);
      const name = employee?.name || record.employeeName;
      const title = employee?.title || record.title || '';
      if (title.includes('調度副主任')) result.deputyDirectors.push(name);
      else if (title.includes('調度主任') || title.includes('主官'))
        result.directors.push(name);
      if (record.scheduleCode.includes('監'))
        (record.scheduleCode.includes('國上')
          ? result.newTaipei
          : result.taipei
        ).push(name);
    });
  for (const key of Object.keys(result) as Array<keyof DutyStaff>)
    result[key] = [...new Set(result[key])];
  return result;
}

export function AdminConsole({
  employeeId,
  employeeName,
  role,
  onExit,
  onSignOut,
}: {
  employeeId: string;
  employeeName: string;
  role: BackendRole;
  onExit: () => void;
  onSignOut: () => void;
}) {
  const [page, setPage] = useState<Page>('dashboard');
  const admin = role === 'admin';
  const monitorItems: Array<[Page, string, React.ReactNode]> = [
    ['dashboard', admin ? '管理總覽' : '監控總覽', <BarChart3 size={18} />],
    ['dispatch', admin ? '派工管理' : '今日派工', <ClipboardList size={18} />],
    ['schedule', admin ? '班表管理' : '班表', <CalendarDays size={18} />],
    ['broadcasts', admin ? '廣播管理' : '廣播事項', <Megaphone size={18} />],
  ];
  const adminItems: Array<[Page, string, React.ReactNode]> = [
    ['employees', '員工管理', <Users size={18} />],
    ['pre-settings', '預排班設定', <SlidersHorizontal size={18} />],
    ['system', '系統設定', <Settings size={18} />],
  ];
  return (
    <div className="admin-console">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <b>微笑Bike</b>
          <span>{admin ? 'ADMIN CONSOLE' : 'MONITOR CONSOLE'}</span>
        </div>
        <nav>
          {[
            ...monitorItems,
            ...(admin ? adminItems : []),
            ['leave', '假勤管理', <CalendarDays size={18} />] as [
              Page,
              string,
              React.ReactNode,
            ],
          ].map(([id, label, icon]) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              onClick={() => setPage(id)}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-actions">
          <button onClick={onExit}>返回員工前台</button>
          <button onClick={onSignOut}>
            <LogOut size={16} />
            登出
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <small>{admin ? '管理員後台' : '值班監控後台'}</small>
            <h1>
              {
                [
                  ...monitorItems,
                  ...adminItems,
                  ['leave', '假勤管理', null] as unknown as [
                    Page,
                    string,
                    React.ReactNode,
                  ],
                ].find((item) => item[0] === page)?.[1]
              }
            </h1>
          </div>
          <div>
            <strong>{employeeName}</strong>
            <span>
              {employeeId} · {admin ? 'admin' : 'monitor'}
            </span>
          </div>
        </header>
        <section className="admin-content">
          {page === 'dashboard' && (
            <Dashboard role={role} onOpenDispatch={() => setPage('dispatch')} />
          )}
          {page === 'dispatch' && <DispatchManager employeeId={employeeId} />}
          {page === 'schedule' && (
            <ScheduleManager employeeId={employeeId} admin={admin} />
          )}
          {page === 'broadcasts' && (
            <BroadcastManager employeeId={employeeId} admin={admin} />
          )}
          {page === 'employees' && admin && <EmployeeManager />}
          {page === 'pre-settings' && admin && (
            <PreScheduleSettings employeeId={employeeId} />
          )}
          {page === 'system' && admin && <SystemSettings />}
          {page === 'leave' && (
            <Placeholder
              title="假勤管理"
              text="本輪保留後台入口；完整假勤審核流程尚未啟用。"
            />
          )}
        </section>
      </main>
    </div>
  );
}

function Dashboard({
  role,
  onOpenDispatch,
}: {
  role: BackendRole;
  onOpenDispatch: () => void;
}) {
  const [date, setDate] = useState(todayTaipei);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [blocks, setBlocks] = useState<DispatchBlock[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [list, setList] = useState<{ title: string; people: string[] } | null>(
    null,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([
      listScheduleRecords(date),
      listDispatchBlocks(date),
      getDocs(collection(db, 'employees')),
      getDocs(collection(db, 'broadcasts')),
    ])
      .then(([scheduleRows, dispatchRows, employeeRows, broadcastRows]) => {
        setSchedules(scheduleRows);
        setBlocks(dispatchRows);
        setEmployees(
          employeeRows.docs.map(
            (item) =>
              ({ employeeId: item.id, ...item.data() }) as EmployeeRecord,
          ),
        );
        setBroadcasts(
          broadcastRows.docs.map(
            (item) => ({ id: item.id, ...item.data() }) as Broadcast,
          ),
        );
        setError('');
      })
      .catch((cause) => {
        console.error('[adminDashboard] load failed', cause);
        setError('Dashboard 資料載入失敗');
      });
  }, [date]);
  const names = (records: ScheduleRecord[]) =>
    records.map((record) => record.employeeName).filter(Boolean);
  const working = schedules.filter((record) => !isLeave(record.scheduleCode));
  const morning = working.filter((record) => record.shiftType === 'morning');
  const night = working.filter((record) => record.shiftType === 'night');
  const regular = schedules.filter((record) => record.scheduleCode === '例');
  const rest = schedules.filter((record) => record.scheduleCode === '休');
  const leave = schedules.filter(
    (record) =>
      !['例', '休'].includes(record.scheduleCode) &&
      isLeave(record.scheduleCode),
  );
  const assignedIds = new Set(
    blocks
      .flatMap((block) => [
        ...block.drivers,
        ...block.stations,
        ...block.assistants,
      ])
      .map((person) => person.employeeId)
      .filter(Boolean),
  );
  const pending = blocks
    .flatMap((block) => [
      ...block.drivers,
      ...block.stations,
      ...block.assistants,
    ])
    .filter((person) => !person.employeeId);
  const dutyMorning = deriveDuty(schedules, employees, 'morning');
  const dutyNight = deriveDuty(schedules, employees, 'night');
  const now = Date.now();
  const activeBroadcasts = broadcasts.filter(
    (item) =>
      item.active &&
      (timestampDate(item.startAt)?.getTime() ?? 0) <= now &&
      (timestampDate(item.endAt)?.getTime() ?? Number.MAX_SAFE_INTEGER) >= now,
  );
  const addedToday = broadcasts.filter(
    (item) =>
      timestampDate(item.createdAt)?.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Taipei',
      }) === date,
  );
  const stat = (label: string, value: number, people?: string[]) => (
    <button
      className="admin-stat"
      onClick={() => people && setList({ title: label, people })}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
  return (
    <>
      <div className="admin-page-toolbar">
        <label>
          日期
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <span className="admin-role-note">
          {role === 'admin' ? '完整管理權限' : '派工可編輯／班表只讀'}
        </span>
      </div>
      {error && <div className="admin-alert">{error}</div>}
      <div className="dashboard-layout">
        <section className="admin-panel workforce-panel">
          <header>
            <h2>今日人力</h2>
          </header>
          <div className="stat-grid">
            {stat('早班出勤', morning.length, names(morning))}
            {stat('夜班出勤', night.length, names(night))}
            {stat('例假', regular.length, names(regular))}
            {stat('休假', rest.length, names(rest))}
            {stat('請假', leave.length, names(leave))}
          </div>
        </section>
        <section className="admin-panel dispatch-summary">
          <header>
            <h2>今日派工</h2>
            <button onClick={onOpenDispatch}>進入派工管理</button>
          </header>
          <div className="stat-grid">
            {stat(
              '白天 blocks',
              blocks.filter((block) => block.shiftType === 'day').length,
            )}
            {stat(
              '夜班 blocks',
              blocks.filter((block) => block.shiftType === 'night').length,
            )}
            {stat('已派工人數', assignedIds.size)}
            {stat(
              '待人工派工',
              pending.length,
              pending.map((person) => person.employeeName),
            )}
            {stat(
              '特殊 blocks',
              blocks.filter((block) => !block.areaCode).length,
            )}
          </div>
          {pending.length > 0 && (
            <button className="admin-warning" onClick={onOpenDispatch}>
              今日有 {pending.length} 人尚未完成派工
            </button>
          )}
        </section>
        <section className="admin-panel duty-panel">
          <header>
            <h2>值班資訊</h2>
          </header>
          <div className="duty-columns">
            <DutyColumn title="早班" duty={dutyMorning} showDirector />
            <DutyColumn title="夜班" duty={dutyNight} />
          </div>
        </section>
        <section className="admin-panel broadcast-summary">
          <header>
            <h2>廣播</h2>
          </header>
          <div className="stat-grid">
            {stat('目前啟用', activeBroadcasts.length)}
            {stat('今日新增', addedToday.length)}
            {stat(
              '重要廣播',
              activeBroadcasts.filter((item) => item.type === '重要').length,
            )}
          </div>
        </section>
      </div>
      {list && (
        <Modal title={`${list.title}名單`} onClose={() => setList(null)}>
          <div className="name-list">
            {list.people.length
              ? list.people.map((name, index) => (
                  <span key={`${name}-${index}`}>{name}</span>
                ))
              : '無資料'}
          </div>
        </Modal>
      )}
    </>
  );
}

function DutyColumn({
  title,
  duty,
  showDirector = false,
}: {
  title: string;
  duty: DutyStaff;
  showDirector?: boolean;
}) {
  const line = (label: string, values: string[]) => (
    <div>
      <b>{label}</b>
      <span>{values.join('、') || '未排定'}</span>
    </div>
  );
  return (
    <article>
      <h3>{title}</h3>
      {showDirector && (
        <>
          {line('調度主任', duty.directors)}
          {line('調度副主任', duty.deputyDirectors)}
        </>
      )}
      {line('台北監控', duty.taipei)}
      {line('新北監控', duty.newTaipei)}
    </article>
  );
}

function DispatchManager({ employeeId }: { employeeId: string }) {
  const [date, setDate] = useState(todayTaipei);
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [blocks, setBlocks] = useState<DispatchBlock[]>([]);
  const [areaSearch, setAreaSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [area, setArea] = useState('');
  const [editing, setEditing] = useState<DispatchBlock | null>(null);
  const [draft, setDraft] = useState<DispatchBlockEditable | null>(null);
  const [auditFor, setAuditFor] = useState<DispatchBlock | null>(null);
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      setBlocks(await listDispatchBlocks(date));
      setError('');
    } catch (cause) {
      console.error('[backendDispatch] load failed', cause);
      setError('派工資料載入失敗');
    }
  };
  useEffect(() => {
    void load();
  }, [date]);
  const areas = [
    ...new Set(
      blocks
        .filter((block) => block.shiftType === shift)
        .map((block) => block.areaCode || '特殊派工'),
    ),
  ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const visible = blocks.filter(
    (block) =>
      block.shiftType === shift &&
      (!area || (block.areaCode || '特殊派工') === area) &&
      (!areaSearch ||
        `${block.areaCode} ${block.areaName} ${block.vehicleNo}`
          .toLowerCase()
          .includes(areaSearch.toLowerCase())) &&
      (!employeeSearch ||
        [...block.drivers, ...block.stations, ...block.assistants].some(
          (person) =>
            `${person.employeeId} ${person.employeeName}`
              .toLowerCase()
              .includes(employeeSearch.toLowerCase()),
        )),
  );
  const open = (block: DispatchBlock) => {
    setEditing(block);
    setDraft({
      vehicleNo: block.vehicleNo,
      drivers: block.drivers,
      stations: block.stations,
      assistants: block.assistants,
      workFocus: block.workFocus,
      balanceArea: block.balanceArea,
      note: block.note,
    });
  };
  const parsePeople = (value: string): DispatchBlockPerson[] =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id = '', ...name] = line.split(/\s+/);
        return { employeeId: id.toUpperCase(), employeeName: name.join(' ') };
      });
  const formatPeople = (people: DispatchBlockPerson[]) =>
    people
      .map((person) => `${person.employeeId} ${person.employeeName}`.trim())
      .join('\n');
  const save = async () => {
    if (!editing || !draft) return;
    try {
      await updateDispatchBlock(editing, draft, employeeId);
      await writeDispatchBlockAudit(editing, draft, employeeId);
      setEditing(null);
      setDraft(null);
      await load();
    } catch (cause) {
      console.error('[backendDispatch] save failed', cause);
      setError('派工修改失敗');
    }
  };
  const showAudits = async (block: DispatchBlock) => {
    setAuditFor(block);
    const snapshot = await getDocs(
      query(
        collection(db, 'dispatchAuditLogs'),
        where('recordId', '==', block.id),
      ),
    );
    setAudits(
      snapshot.docs
        .map((item) => item.data())
        .sort(
          (a, b) =>
            (timestampDate(b.createdAt)?.getTime() ?? 0) -
            (timestampDate(a.createdAt)?.getTime() ?? 0),
        ),
    );
  };
  return (
    <>
      <div className="admin-page-toolbar filters">
        <label>
          日期
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          班別
          <select
            value={shift}
            onChange={(event) =>
              setShift(event.target.value as 'day' | 'night')
            }
          >
            <option value="day">早班</option>
            <option value="night">夜班</option>
          </select>
        </label>
        <label>
          區域篩選
          <select
            value={area}
            onChange={(event) => setArea(event.target.value)}
          >
            <option value="">全部區域</option>
            {areas.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          區域搜尋
          <input
            placeholder="區域或車號"
            value={areaSearch}
            onChange={(event) => setAreaSearch(event.target.value)}
          />
        </label>
        <label className="wide">
          員工搜尋
          <input
            placeholder="員編或姓名"
            value={employeeSearch}
            onChange={(event) => setEmployeeSearch(event.target.value)}
          />
        </label>
        <strong>{visible.length} blocks</strong>
      </div>
      {error && <div className="admin-alert">{error}</div>}
      <div className="admin-table-wrap">
        <table className="admin-data-table dispatch-table">
          <thead>
            <tr>
              <th>區域</th>
              <th>車號</th>
              <th>駕駛</th>
              <th>駐點</th>
              <th>隨車</th>
              <th>工作重點</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((block) => (
              <tr key={block.id}>
                <td>
                  <b>{block.areaName || '特殊派工'}</b>
                  <small>{block.areaCode || block.variantCode}</small>
                </td>
                <td>{block.vehicleNo || '—'}</td>
                <td>{peopleNames(block.drivers)}</td>
                <td>{peopleNames(block.stations)}</td>
                <td>{peopleNames(block.assistants)}</td>
                <td className="focus-cell">{block.workFocus || '—'}</td>
                <td>
                  <button onClick={() => open(block)}>修改</button>
                  <button onClick={() => void showAudits(block)}>
                    查看修改紀錄
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && draft && (
        <Modal
          title={`${editing.areaName || '特殊派工'} · ${editing.vehicleNo || '無車號'}`}
          onClose={() => setEditing(null)}
        >
          <div className="admin-edit-grid">
            <label>
              車號
              <input
                value={draft.vehicleNo}
                onChange={(event) =>
                  setDraft({ ...draft, vehicleNo: event.target.value })
                }
              />
            </label>
            <label>
              駕駛（每行員編＋姓名）
              <textarea
                value={formatPeople(draft.drivers)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    drivers: parsePeople(event.target.value),
                  })
                }
              />
            </label>
            <label>
              駐點
              <textarea
                value={formatPeople(draft.stations)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    stations: parsePeople(event.target.value),
                  })
                }
              />
            </label>
            <label>
              隨車
              <textarea
                value={formatPeople(draft.assistants)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    assistants: parsePeople(event.target.value),
                  })
                }
              />
            </label>
            <label>
              工作重點
              <textarea
                value={draft.workFocus}
                onChange={(event) =>
                  setDraft({ ...draft, workFocus: event.target.value })
                }
              />
            </label>
            <label>
              平衡區域
              <input
                value={draft.balanceArea}
                onChange={(event) =>
                  setDraft({ ...draft, balanceArea: event.target.value })
                }
              />
            </label>
            <label>
              備註
              <textarea
                value={draft.note}
                onChange={(event) =>
                  setDraft({ ...draft, note: event.target.value })
                }
              />
            </label>
          </div>
          <button className="admin-primary" onClick={() => void save()}>
            儲存修改
          </button>
        </Modal>
      )}
      {auditFor && (
        <Modal
          title={`${auditFor.areaName} 修改紀錄`}
          onClose={() => setAuditFor(null)}
        >
          <div className="audit-list">
            {audits.length ? (
              audits.map((audit, index) => (
                <article key={index}>
                  <header>
                    <b>{displayTime(audit.createdAt)}</b>
                    <span>{String(audit.modifiedBy || '—')}</span>
                  </header>
                  <details>
                    <summary>修改前／修改後</summary>
                    <pre>
                      {JSON.stringify(
                        { before: audit.before, after: audit.after },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              ))
            ) : (
              <p>尚無人工修改紀錄。</p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function ScheduleManager({
  employeeId,
  admin,
}: {
  employeeId: string;
  admin: boolean;
}) {
  const [month, setMonth] = useState(todayTaipei().slice(0, 7));
  const [records, setRecords] = useState<ScheduleRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [rows, people] = await Promise.all([
        listMonthScheduleRecords(month),
        getDocs(collection(db, 'employees')),
      ]);
      setRecords(rows);
      setEmployees(
        people.docs.map(
          (item) => ({ employeeId: item.id, ...item.data() }) as EmployeeRecord,
        ),
      );
      setError('');
    } catch (cause) {
      console.error('[scheduleManager] load failed', cause);
      setError('班表載入失敗');
    }
  };
  useEffect(() => {
    void load();
  }, [month]);
  const days = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const profiles = new Map(
    employees.map((person) => [person.employeeId, person]),
  );
  const rows = useMemo(() => {
    const grouped = new Map<string, ScheduleRecord[]>();
    records.forEach((record) =>
      grouped.set(record.employeeId, [
        ...(grouped.get(record.employeeId) || []),
        record,
      ]),
    );
    return [...grouped]
      .map(([id, items]) => ({ id, employee: profiles.get(id), items }))
      .filter(
        (row) => !search || `${row.id} ${row.employee?.name}`.includes(search),
      )
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }, [records, employees, search]);
  const edit = async (
    record: ScheduleRecord | undefined,
    person: EmployeeRecord | undefined,
    day: number,
  ) => {
    if (!admin || !record || !person) return;
    const next = window.prompt(
      `${person.employeeId} ${person.name}\n${month}-${String(day).padStart(2, '0')} 班別`,
      record.scheduleCode,
    );
    if (next === null || next.trim() === record.scheduleCode) return;
    const code = next.trim();
    if (
      !code ||
      !window.confirm(
        `確認將 ${person.name} ${month}/${day} 從「${record.scheduleCode}」改為「${code}」？`,
      )
    )
      return;
    try {
      const batch = writeBatch(db);
      const auditRef = doc(collection(db, 'scheduleAuditLogs'));
      batch.update(doc(db, 'scheduleRecords', record.id), {
        scheduleCode: code,
        scheduleLabel: code,
        leaveType: isLeave(code) ? code : '',
        modifiedBy: employeeId,
        modifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(auditRef, {
        recordId: record.id,
        employeeId: record.employeeId,
        date: record.date,
        before: {
          scheduleCode: record.scheduleCode,
          scheduleLabel: record.scheduleLabel,
          leaveType: record.leaveType,
        },
        after: {
          scheduleCode: code,
          scheduleLabel: code,
          leaveType: isLeave(code) ? code : '',
        },
        modifiedBy: employeeId,
        modifiedAt: serverTimestamp(),
      });
      await batch.commit();
      await load();
    } catch (cause) {
      console.error('[scheduleManager] update failed', cause);
      setError('班表修改失敗');
    }
  };
  return (
    <>
      <div className="admin-page-toolbar filters">
        <label>
          月份
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label className="wide">
          搜尋員工
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="員編或姓名"
          />
        </label>
        <span className="admin-role-note">
          {admin
            ? '點擊班別可修改；儲存時同步寫入 audit'
            : 'monitor 僅可查看正式班表'}
        </span>
      </div>
      {error && <div className="admin-alert">{error}</div>}
      <div className="admin-schedule-wrap">
        <table className="admin-schedule">
          <thead>
            <tr>
              <th>職稱</th>
              <th>員編</th>
              <th>姓名</th>
              {Array.from({ length: days }, (_, index) => (
                <th key={index + 1}>{index + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.employee?.title || '—'}</td>
                <td>{row.id}</td>
                <td>
                  {row.employee?.name || row.items[0]?.employeeName || '—'}
                </td>
                {Array.from({ length: days }, (_, index) => {
                  const record = row.items.find(
                    (item) => Number(item.date.slice(8)) === index + 1,
                  );
                  return (
                    <td
                      key={index}
                      className={
                        isLeave(record?.scheduleCode || '') ? 'leave-cell' : ''
                      }
                    >
                      <button
                        disabled={!admin || !record}
                        onClick={() =>
                          void edit(record, row.employee, index + 1)
                        }
                      >
                        {record?.scheduleCode || '—'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BroadcastManager({
  employeeId,
  admin,
}: {
  employeeId: string;
  admin: boolean;
}) {
  type Draft = {
    title: string;
    content: string;
    type: Broadcast['type'];
    targetType: Broadcast['targetType'];
    targetValues: string;
    startAt: string;
    endAt: string;
    popupMode: Broadcast['popupMode'];
    active: boolean;
    imageUrl: string;
    linkUrl: string;
  };
  const empty: Draft = {
    title: '',
    content: '',
    type: '一般',
    targetType: 'all',
    targetValues: '',
    startAt: '',
    endAt: '',
    popupMode: 'daily',
    active: true,
    imageUrl: '',
    linkUrl: '',
  };
  const [items, setItems] = useState<Broadcast[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personSearch, setPersonSearch] = useState('');
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = async () => {
    const snapshot = await getDocs(collection(db, 'broadcasts'));
    setItems(
      snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Broadcast)
        .sort(
          (a, b) =>
            (timestampDate(b.createdAt)?.getTime() ?? 0) -
            (timestampDate(a.createdAt)?.getTime() ?? 0),
        ),
    );
  };
  useEffect(() => {
    void load();
    void getDocs(collection(db, 'employees')).then((snapshot) =>
      setPeople(
        snapshot.docs.map((item) => ({
          employeeId: item.id,
          name: String(item.data().name || ''),
        })),
      ),
    );
  }, []);
  const open = (item?: Broadcast) => {
    setEditing(item || null);
    setDraft(
      item
        ? {
            title: item.title,
            content: item.content,
            type: item.type,
            targetType: item.targetType,
            targetValues: (item.targetValues || []).join(','),
            startAt: datetimeValue(item.startAt),
            endAt: datetimeValue(item.endAt),
            popupMode: item.popupMode,
            active: item.active,
            imageUrl: item.imageUrl || '',
            linkUrl: item.linkUrl || '',
          }
        : { ...empty },
    );
  };
  const save = async () => {
    if (!draft || !draft.title.trim() || !draft.content.trim()) return;
    const payload = {
      ...draft,
      targetValues: draft.targetValues
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      startAt: draft.startAt
        ? Timestamp.fromDate(new Date(draft.startAt))
        : null,
      endAt: draft.endAt ? Timestamp.fromDate(new Date(draft.endAt)) : null,
      updatedAt: serverTimestamp(),
    };
    if (editing?.id)
      await updateDoc(doc(db, 'broadcasts', editing.id), payload);
    else
      await addDoc(collection(db, 'broadcasts'), {
        ...payload,
        createdBy: employeeId,
        createdAt: serverTimestamp(),
      });
    setDraft(null);
    setEditing(null);
    await load();
  };
  const toggle = async (item: Broadcast) => {
    await updateDoc(doc(db, 'broadcasts', item.id), {
      active: !item.active,
      updatedAt: serverTimestamp(),
    });
    await load();
  };
  const remove = async (item: Broadcast) => {
    if (window.confirm(`確定刪除「${item.title}」？`)) {
      await deleteDoc(doc(db, 'broadcasts', item.id));
      await load();
    }
  };
  const selectedIds =
    draft?.targetValues
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) || [];
  const candidates = people
    .filter((person) =>
      `${person.employeeId} ${person.name}`.includes(personSearch),
    )
    .slice(0, 30);
  const togglePerson = (id: string) => {
    if (!draft) return;
    const ids = selectedIds.includes(id)
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id];
    setDraft({ ...draft, targetValues: ids.join(',') });
  };
  return (
    <>
      <div className="admin-page-toolbar">
        <div>
          <strong>{items.length} 則廣播</strong>
          <span className="admin-role-note">
            {admin ? '可新增、修改、複製、停用與刪除' : 'monitor 僅可查看'}
          </span>
        </div>
        {admin && (
          <button className="admin-primary" onClick={() => open()}>
            新增廣播
          </button>
        )}
      </div>
      <div className="admin-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>標題</th>
              <th>類型</th>
              <th>對象</th>
              <th>顯示</th>
              <th>期間</th>
              <th>狀態</th>
              {admin && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <b>{item.title}</b>
                  <small>{item.content.slice(0, 60)}</small>
                </td>
                <td>{item.type}</td>
                <td>
                  {item.targetType}
                  <small>{item.targetValues?.join('、')}</small>
                </td>
                <td>{item.popupMode}</td>
                <td>
                  {displayTime(item.startAt)}
                  <small>至 {displayTime(item.endAt)}</small>
                </td>
                <td>{item.active ? '啟用' : '停用'}</td>
                {admin && (
                  <td>
                    <button onClick={() => open(item)}>修改</button>
                    <button
                      onClick={() =>
                        open({
                          ...item,
                          id: '',
                          title: `${item.title}（複製）`,
                          active: false,
                        })
                      }
                    >
                      複製
                    </button>
                    <button onClick={() => void toggle(item)}>
                      {item.active ? '停用' : '啟用'}
                    </button>
                    <button onClick={() => void remove(item)}>刪除</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && (
        <Modal
          title={editing?.id ? '修改廣播' : '新增廣播'}
          onClose={() => setDraft(null)}
        >
          <div className="admin-edit-grid">
            <label>
              標題
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              內文
              <textarea
                value={draft.content}
                onChange={(event) =>
                  setDraft({ ...draft, content: event.target.value })
                }
              />
            </label>
            <label>
              類型
              <select
                value={draft.type}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    type: event.target.value as Broadcast['type'],
                  })
                }
              >
                <option>一般</option>
                <option>提醒</option>
                <option>重要</option>
              </select>
            </label>
            <label>
              指定對象
              <select
                value={draft.targetType}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    targetType: event.target.value as Broadcast['targetType'],
                    targetValues: '',
                  })
                }
              >
                <option value="all">全體</option>
                <option value="morning">早班</option>
                <option value="night">夜班</option>
                <option value="employee">指定員工</option>
                <option value="area">指定區域</option>
              </select>
            </label>
            {draft.targetType === 'employee' ? (
              <div className="employee-picker">
                <label>
                  搜尋員工
                  <input
                    value={personSearch}
                    onChange={(event) => setPersonSearch(event.target.value)}
                    placeholder="員編或姓名"
                  />
                </label>
                <div>
                  {candidates.map((person) => (
                    <button
                      className={
                        selectedIds.includes(person.employeeId)
                          ? 'selected'
                          : ''
                      }
                      key={person.employeeId}
                      onClick={() => togglePerson(person.employeeId)}
                    >
                      {person.employeeId} · {person.name}
                    </button>
                  ))}
                </div>
                <small>已選 {selectedIds.length} 人</small>
              </div>
            ) : draft.targetType === 'area' ? (
              <label>
                指定區域（逗號分隔）
                <input
                  value={draft.targetValues}
                  onChange={(event) =>
                    setDraft({ ...draft, targetValues: event.target.value })
                  }
                />
              </label>
            ) : (
              <span />
            )}
            <label>
              開始時間
              <input
                type="datetime-local"
                value={draft.startAt}
                onChange={(event) =>
                  setDraft({ ...draft, startAt: event.target.value })
                }
              />
            </label>
            <label>
              結束時間
              <input
                type="datetime-local"
                value={draft.endAt}
                onChange={(event) =>
                  setDraft({ ...draft, endAt: event.target.value })
                }
              />
            </label>
            <label>
              顯示模式
              <select
                value={draft.popupMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    popupMode: event.target.value as Broadcast['popupMode'],
                  })
                }
              >
                <option>once</option>
                <option>daily</option>
                <option>always</option>
                <option>none</option>
              </select>
            </label>
            <label>
              圖片 URL
              <input
                value={draft.imageUrl}
                onChange={(event) =>
                  setDraft({ ...draft, imageUrl: event.target.value })
                }
              />
            </label>
            <label>
              連結 URL
              <input
                value={draft.linkUrl}
                onChange={(event) =>
                  setDraft({ ...draft, linkUrl: event.target.value })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) =>
                  setDraft({ ...draft, active: event.target.checked })
                }
              />
              啟用
            </label>
          </div>
          <article className={`broadcast-preview preview-${draft.type}`}>
            <small>預覽</small>
            <h3>{draft.title || '廣播標題'}</h3>
            <p>{draft.content || '廣播內容'}</p>
            {draft.imageUrl && <img src={draft.imageUrl} alt="廣播預覽" />}
          </article>
          <button className="admin-primary" onClick={() => void save()}>
            儲存
          </button>
        </Modal>
      )}
    </>
  );
}

function EmployeeManager() {
  const [items, setItems] = useState<EmployeeRecord[]>([]);
  const [editing, setEditing] = useState<EmployeeRecord | null>(null);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [shift, setShift] = useState('');
  const [sortKey, setSortKey] = useState<
    'employeeId' | 'name' | 'title' | 'hireDate' | 'role' | 'active'
  >('employeeId');
  const [shiftMap, setShiftMap] = useState<Map<string, Set<string>>>(new Map());
  const load = async () => {
    const call = httpsCallable<undefined, { employees: EmployeeRecord[] }>(
      functions,
      'adminListEmployees',
    );
    setItems((await call()).data.employees);
    const schedules = await listMonthScheduleRecords(todayTaipei().slice(0, 7));
    const map = new Map<string, Set<string>>();
    schedules.forEach((record) =>
      map.set(
        record.employeeId,
        new Set([...(map.get(record.employeeId) || []), record.shiftType]),
      ),
    );
    setShiftMap(map);
  };
  useEffect(() => {
    void load();
  }, []);
  const titles = [
    ...new Set(items.map((item) => item.title).filter(Boolean)),
  ].sort();
  const visible = items
    .filter(
      (item) =>
        (!search || `${item.employeeId} ${item.name}`.includes(search)) &&
        (!title || item.title === title) &&
        (!role || item.role === role) &&
        (!active || String(item.active) === active) &&
        (!shift || shiftMap.get(item.employeeId)?.has(shift)),
    )
    .sort((left, right) =>
      String(left[sortKey] ?? '').localeCompare(
        String(right[sortKey] ?? ''),
        'zh-TW',
        { numeric: true },
      ),
    );
  const tenure = (hireDate: string) => {
    if (!hireDate) return '—';
    const years = (Date.now() - new Date(hireDate).getTime()) / 31557600000;
    return Number.isFinite(years) ? `${Math.max(0, years).toFixed(1)} 年` : '—';
  };
  const save = async () => {
    if (!editing) return;
    const call = httpsCallable<EmployeeRecord, { employeeId: string }>(
      functions,
      'adminSaveEmployee',
    );
    await call(editing);
    setEditing(null);
    await load();
  };
  const toggle = async (item: EmployeeRecord) => {
    if (
      !window.confirm(
        `${item.active ? '停用' : '啟用'} ${item.employeeId} ${item.name}？`,
      )
    )
      return;
    const call = httpsCallable<
      { employeeId: string; active: boolean },
      { success: boolean }
    >(functions, 'adminSetActive');
    await call({ employeeId: item.employeeId, active: !item.active });
    await load();
  };
  const reset = async (item: EmployeeRecord) => {
    if (!window.confirm(`強制重設 ${item.employeeId} ${item.name}？`)) return;
    const call = httpsCallable<{ employeeId: string }, { success: boolean }>(
      functions,
      'adminResetPassword',
    );
    await call({ employeeId: item.employeeId });
    await load();
  };
  return (
    <>
      <div className="admin-page-toolbar filters">
        <label className="wide">
          員編／姓名
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          職稱
          <select
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          >
            <option value="">全部</option>
            {titles.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          班別
          <select
            value={shift}
            onChange={(event) => setShift(event.target.value)}
          >
            <option value="">全部</option>
            <option value="morning">早班</option>
            <option value="night">夜班</option>
          </select>
        </label>
        <label>
          角色
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="">全部</option>
            <option value="employee">employee</option>
            <option value="duty">monitor</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          狀態
          <select
            value={active}
            onChange={(event) => setActive(event.target.value)}
          >
            <option value="">全部</option>
            <option value="true">啟用</option>
            <option value="false">停用</option>
          </select>
        </label>
        <label>
          排序
          <select
            value={sortKey}
            onChange={(event) =>
              setSortKey(
                event.target.value as
                  | 'employeeId'
                  | 'name'
                  | 'title'
                  | 'hireDate'
                  | 'role'
                  | 'active',
              )
            }
          >
            <option value="employeeId">員編</option>
            <option value="name">姓名</option>
            <option value="title">職稱</option>
            <option value="hireDate">到職日</option>
            <option value="role">角色</option>
            <option value="active">狀態</option>
          </select>
        </label>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>員編</th>
              <th>姓名</th>
              <th>職稱</th>
              <th>到職日</th>
              <th>年資</th>
              <th>角色</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.employeeId}>
                <td>{item.employeeId}</td>
                <td>{item.name}</td>
                <td>{item.title}</td>
                <td>{item.hireDate || '—'}</td>
                <td>{tenure(item.hireDate)}</td>
                <td>{item.role}</td>
                <td>{item.active ? '啟用' : '停用'}</td>
                <td>
                  <button onClick={() => setEditing(item)}>編輯</button>
                  <button onClick={() => void toggle(item)}>
                    {item.active ? '停用' : '啟用'}
                  </button>
                  <button onClick={() => void reset(item)}>重設帳號</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal
          title={`編輯 ${editing.employeeId}`}
          onClose={() => setEditing(null)}
        >
          <div className="admin-edit-grid">
            <label>
              員編
              <input
                disabled
                value={editing.employeeId}
              />
            </label>
            <label>
              姓名
              <input disabled value={editing.name} />
            </label>
            <label>
              職稱
              <input
                value={editing.title}
                onChange={(event) =>
                  setEditing({ ...editing, title: event.target.value })
                }
              />
            </label>
            <label>
              到職日
              <input
                type="date"
                value={editing.hireDate}
                onChange={(event) =>
                  setEditing({ ...editing, hireDate: event.target.value })
                }
              />
            </label>
            <label>
              角色
              <select
                value={editing.role}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    role: event.target.value as EmployeeRecord['role'],
                  })
                }
              >
                <option value="employee">employee</option>
                <option value="duty">monitor</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(event) =>
                  setEditing({ ...editing, active: event.target.checked })
                }
              />
              帳號啟用
            </label>
          </div>
          <button className="admin-primary" onClick={() => void save()}>
            儲存
          </button>
        </Modal>
      )}
    </>
  );
}

function PreScheduleSettings({ employeeId }: { employeeId: string }) {
  const nextMonth = (() => {
    const date = new Date(`${todayTaipei()}T00:00:00`);
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 7);
  })();
  const [month, setMonth] = useState(nextMonth);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [status, setStatus] = useState<'scheduled' | 'open' | 'closed'>(
    'scheduled',
  );
  const load = async () => {
    const snapshot = await getDoc(doc(db, 'scheduleSettings', month));
    if (snapshot.exists()) {
      const data = snapshot.data();
      setStartAt(datetimeValue(data.startAt));
      setEndAt(datetimeValue(data.endAt));
      setStatus(data.status || 'scheduled');
    } else {
      setStartAt('');
      setEndAt('');
      setStatus('scheduled');
    }
  };
  useEffect(() => {
    void load();
  }, [month]);
  const save = async (nextStatus = status) => {
    await setDoc(
      doc(db, 'scheduleSettings', month),
      {
        targetMonth: month,
        startAt: startAt ? Timestamp.fromDate(new Date(startAt)) : null,
        endAt: endAt ? Timestamp.fromDate(new Date(endAt)) : null,
        status: nextStatus,
        updatedBy: employeeId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setStatus(nextStatus);
  };
  const extendOneDay = () => {
    const base = endAt ? new Date(endAt) : new Date();
    base.setDate(base.getDate() + 1);
    const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setEndAt(local);
  };
  return (
    <div className="settings-grid">
      <section className="admin-panel settings-panel">
        <header>
          <h2>預排班開放設定</h2>
          <span className={`setting-status ${status}`}>
            {status === 'open'
              ? '開放中'
              : status === 'closed'
                ? '已關閉'
                : '預定'}
          </span>
        </header>
        <label>
          目標排班月份
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label>
          開放時間
          <input
            type="datetime-local"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
          />
        </label>
        <label>
          截止時間
          <input
            type="datetime-local"
            value={endAt}
            onChange={(event) => setEndAt(event.target.value)}
          />
        </label>
        <div className="settings-actions">
          <button className="admin-primary" onClick={() => void save()}>
            儲存時間
          </button>
          <button onClick={() => void save('open')}>立即開放／重新開放</button>
          <button onClick={() => void save('closed')}>立即關閉</button>
          <button onClick={extendOneDay}>延長 1 天</button>
        </div>
        <p>
          開放期間由管理員設定，不寫死每月 10～20 日；按「延長 1
          天」後再儲存即可生效。
        </p>
      </section>
    </div>
  );
}

function SystemSettings() {
  return (
    <div className="settings-grid">
      <section className="admin-panel settings-panel">
        <header>
          <h2>系統設定</h2>
        </header>
        <div className="setting-row">
          <span>
            <b>打卡備案</b>
            <small>一般員工前台功能</small>
          </span>
          <strong className="setting-off">attendanceEnabled = false</strong>
        </div>
        <div className="setting-row">
          <span>
            <b>廣播功能</b>
            <small>broadcasts / broadcastReads</small>
          </span>
          <strong>啟用</strong>
        </div>
        <div className="setting-row">
          <span>
            <b>正式派工</b>
            <small>dispatchBlocks runtime</small>
          </span>
          <strong>啟用</strong>
        </div>
        <p>
          第一版提供設定入口與目前 feature flags
          狀態；涉及正式環境的開關仍由程式設定及後端權限控制。
        </p>
      </section>
    </div>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="admin-panel placeholder">
      <CalendarDays size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-modal-backdrop">
      <section className="admin-modal" role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
