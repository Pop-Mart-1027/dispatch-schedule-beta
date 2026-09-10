'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { scheduleSections } from '../functions/pre-schedule-order.mjs';
import { monthSections } from '../functions/month-schedule-layout.mjs';
import { getMonthLayout, manageMonthRow, type MonthLayout } from '../lib/month-schedule-layout';
import { MonthRowManager } from './month-row-manager';
import { WorkFocus } from './work-focus';
import { AreaJumpDropdown, scheduleSectionId } from './area-jump-dropdown';
import { SystemFeatureSettings } from './system-feature-settings';
import { ScheduleCellEditor } from './schedule-cell-editor';
import { buildScheduleEditCatalog } from '../lib/schedule-edit-catalog';
import { updateFormalScheduleCell } from '../lib/schedule-firestore';
import { PreScheduleAdmin } from './pre-schedule-admin';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  ImageUp,
  LogOut,
  Megaphone,
  Settings,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { db, functions } from '../lib/firebase';
import { monitorDisplayRows } from '../lib/monitor-display';
import { popupModeLabels, targetTypeLabels, variantLabels, readableAudit } from '../lib/ui-labels';
import {
  buildDispatchPreviewBlocks,
  listDispatchBlocks,
  listDispatchBlockTemplate,
  saveDispatchPreviewAsFormal,
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
import {
  ADMIN_TITLE_OPTIONS,
  employeeAdminOrder,
  isStandardAdminTitle,
  permissionLabel,
} from '../lib/admin-employee-order';
import {
  dispatchAssignmentStatusLabel,
  assignSchedulesToDispatchBlocks,
  parseScheduleAssignment,
  summarizeDispatchAssignment,
  type AssignedDispatchBlock,
} from '../lib/dispatch-schedule-assignment';
import {
  getCurrentAnnouncement,
  removeCurrentAnnouncement,
  uploadCurrentAnnouncement,
  type AnnouncementImage,
} from '../lib/announcements';

type BackendRole = 'duty' | 'admin';
type Page =
  | 'dashboard'
  | 'dispatch'
  | 'schedule'
  | 'announcements'
  | 'broadcasts'
  | 'employees'
  | 'pre-settings'
  | 'pre-management'
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
type Person = { employeeId: string; name: string; title: string };
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
    .sort((left, right) => {
      const leftEmployee = profiles.get(left.employeeId) || { employeeId: left.employeeId, title: left.title || '' };
      const rightEmployee = profiles.get(right.employeeId) || { employeeId: right.employeeId, title: right.title || '' };
      return employeeAdminOrder(leftEmployee, rightEmployee);
    })
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
    ['pre-management', '預排管理', <CalendarDays size={18} />],
    ['schedule', admin ? '班表管理' : '班表', <CalendarDays size={18} />],
    ['broadcasts', admin ? '廣播管理' : '廣播事項', <Megaphone size={18} />],
  ];
  const adminItems: Array<[Page, string, React.ReactNode]> = [
    ['announcements', '公告管理', <ImageUp size={18} />],
    ['employees', '員工管理', <Users size={18} />],
    ['pre-settings', '預排班設定', <SlidersHorizontal size={18} />],
    ['system', '系統設定', <Settings size={18} />],
  ];
  return (
    <div className="admin-console">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <b>微笑Bike</b>
          <span>{admin ? '管理後台' : '值班監控後台'}</span>
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
              {employeeId} · {permissionLabel(role)}
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
          {page === 'announcements' && admin && (
            <AnnouncementManager employeeId={employeeId} />
          )}
          {page === 'employees' && admin && <EmployeeManager />}
          {page === 'pre-settings' && admin && (
            <PreScheduleSettings employeeId={employeeId} />
          )}
          {page === 'pre-management' && <PreScheduleAdmin admin={admin} />}
          {page === 'system' && admin && <SystemSettings employeeId={employeeId} />}
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
        setError('總覽資料載入失敗');
      });
  }, [date]);
  const employeeProfiles = new Map(
    employees.map((employee) => [employee.employeeId, employee]),
  );
  const names = (records: ScheduleRecord[]) =>
    records
      .map((record) => ({
        employeeId: record.employeeId,
        name: employeeProfiles.get(record.employeeId)?.name || record.employeeName,
        title: employeeProfiles.get(record.employeeId)?.title || record.title || '',
      }))
      .sort(employeeAdminOrder)
      .map((person) => person.name)
      .filter(Boolean);
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
  const originalPeople = blocks.flatMap((block) => [
    ...block.drivers,
    ...block.stations,
    ...block.assistants,
  ]);
  const originalAssignedIds = new Set(
    originalPeople
      .map((person) => person.employeeId)
      .filter(Boolean),
  );
  const dayAssignment = assignSchedulesToDispatchBlocks({
    blocks,
    schedules,
    employees,
    shift: 'day',
  });
  const nightAssignment = assignSchedulesToDispatchBlocks({
    blocks,
    schedules,
    employees,
    shift: 'night',
  });
  const dayDispatch = summarizeDispatchAssignment(
    dayAssignment.blocks,
    dayAssignment.unmatched,
  );
  const nightDispatch = summarizeDispatchAssignment(
    nightAssignment.blocks,
    nightAssignment.unmatched,
  );
  const assignmentPeople = (assignment: typeof dayAssignment) => {
    const peopleById = new Map(
      assignment.blocks
        .flatMap((block) => [
          ...block.drivers,
          ...block.stations,
          ...block.assistants,
        ])
        .filter((person) => person.employeeId)
        .map((person) => [
          person.employeeId,
          employeeProfiles.get(person.employeeId) || {
            employeeId: person.employeeId,
            name: person.employeeName,
            title: '',
          },
        ]),
    );
    return [...peopleById.values()]
      .sort(employeeAdminOrder)
      .map((person) => person.name);
  };
  const pending = [...dayAssignment.unmatched, ...nightAssignment.unmatched];
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
  const stat = (label: string, value: number, people?: string[]) => {
    const Element = people ? 'button' : 'div';
    return <Element
      className="admin-stat"
      onClick={() => people && setList({ title: label, people })}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </Element>;
  };
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
              '日班出勤人數',
              dayDispatch.uniquePeople,
              assignmentPeople(dayAssignment),
            )}
            {stat(
              '夜班出勤人數',
              nightDispatch.uniquePeople,
              assignmentPeople(nightAssignment),
            )}
            {stat(
              '日班出車數',
              dayDispatch.blocks,
            )}
            {stat(
              '夜班出車數',
              nightDispatch.blocks,
            )}
            {stat(
              '多人共車數',
              dayDispatch.sharedVehicleBlocks +
                nightDispatch.sharedVehicleBlocks,
            )}
            {stat(
              '閒置車輛',
              dayDispatch.noDriverBlocks + nightDispatch.noDriverBlocks,
            )}
            {stat(
              '待人工調整人數',
              pending.length,
              pending.map((person) => person.employeeName),
            )}
          </div>
          {pending.length > 0 && (
            <button className="admin-warning" onClick={onOpenDispatch}>
              今日有 {pending.length} 人待人工調整
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
      {monitorDisplayRows(duty.taipei, duty.newTaipei).map(({ label, name }) => (
        <div key={`${label}-${name}`}><b>{label}</b><span>{name}</span></div>
      ))}
    </article>
  );
}

function DispatchManager({ employeeId }: { employeeId: string }) {
  const [date, setDate] = useState(todayTaipei);
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [blocks, setBlocks] = useState<DispatchBlock[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [preview, setPreview] = useState(false);
  const [importDate, setImportDate] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [showPending, setShowPending] = useState(false);
  const [areaSearch, setAreaSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');
  const [area, setArea] = useState('');
  const [editing, setEditing] = useState<DispatchBlock | null>(null);
  const [draft, setDraft] = useState<DispatchBlockEditable | null>(null);
  const [auditFor, setAuditFor] = useState<DispatchBlock | null>(null);
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [dispatchRows, scheduleRows, employeeRows] = await Promise.all([
        listDispatchBlocks(date),
        listScheduleRecords(date),
        getDocs(collection(db, 'employees')),
      ]);
      if (dispatchRows.length) {
        setBlocks(dispatchRows);
        setPreview(false);
      } else {
        const template = await listDispatchBlockTemplate(date);
        setBlocks(buildDispatchPreviewBlocks(template.blocks, date));
        setPreview(template.blocks.length > 0);
      }
      setSchedules(scheduleRows);
      setEmployees(
        employeeRows.docs.map(
          (item) => ({ employeeId: item.id, ...item.data() }) as EmployeeRecord,
        ),
      );
      setError('');
    } catch (cause) {
      console.error('[backendDispatch] load failed', cause);
      setError('派工資料載入失敗');
    }
  };
  useEffect(() => {
    void load();
  }, [date]);
  const dayAssignment = useMemo(
    () => assignSchedulesToDispatchBlocks({ blocks, schedules, employees, shift: 'day' }),
    [blocks, schedules, employees],
  );
  const nightAssignment = useMemo(
    () => assignSchedulesToDispatchBlocks({ blocks, schedules, employees, shift: 'night' }),
    [blocks, schedules, employees],
  );
  const importGoogle = async () => {
    if (!importDate || importing) return;
    setImporting(true); setImportMessage('');
    try {
      const call = httpsCallable<{ date: string; confirmed: boolean }, { date: string; dayBlocks: number; nightBlocks: number; conflicts: number }>(functions, 'syncDispatchBlocks');
      const { data } = await call({ date: importDate, confirmed: true });
      setImportMessage(`已帶入 ${data.date}：日班 ${data.dayBlocks} 個派工區塊、夜班 ${data.nightBlocks} 個派工區塊${data.conflicts ? `；${data.conflicts} 筆姓名無法確認，已保留待處理紀錄` : ''}`);
      setImportDate(null);
      await load();
    } catch (cause) {
      console.error('[googleManualImport] failed', cause);
      setImportMessage('帶入失敗：' + (cause instanceof Error && /[\u3400-\u9fff]/.test(cause.message) ? cause.message : '請確認網路或聯絡管理員'));
      setImportDate(null);
    } finally { setImporting(false); }
  };
  const assignment = shift === 'day' ? dayAssignment : nightAssignment;
  const assignedBlocks = assignment.blocks;
  useEffect(() => { setShowPending(false); }, [date, shift]);
  const areas = [
    ...new Set(
      assignedBlocks.map((block) => block.areaCode || '特殊派工'),
    ),
  ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const visible = assignedBlocks.filter(
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
  const employeeById = new Map(
    employees.map((employee) => [employee.employeeId, employee]),
  );
  const pickerPeople = [
    ...new Map(
      schedules
        .filter(
          (record) =>
            record.shiftType === (shift === 'day' ? 'morning' : 'night') &&
            parseScheduleAssignment(
              record.scheduleCode,
              assignedBlocks.map((block) => block.areaCode || ''),
            ).kind !== 'off',
        )
        .map((record) => {
          const profile = employeeById.get(record.employeeId);
          return [
            record.employeeId,
            {
              employeeId: record.employeeId,
              name: profile?.name || record.employeeName,
              title: profile?.title || record.title || '',
            },
          ] as const;
        }),
    ).values(),
  ]
    .filter(
      (person) =>
        !pickerSearch ||
        `${person.employeeId} ${person.name} ${person.title}`.includes(
          pickerSearch,
        ),
    )
    .sort(employeeAdminOrder)
    .slice(0, 60);
  const open = (block: AssignedDispatchBlock) => {
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
  const assignPerson = (
    person: Person,
    field: 'drivers' | 'stations' | 'assistants',
  ) => {
    if (!draft) return;
    const selected = { employeeId: person.employeeId, employeeName: person.name };
    setDraft({
      ...draft,
      drivers: draft.drivers.filter((item) => item.employeeId !== person.employeeId),
      stations: draft.stations.filter((item) => item.employeeId !== person.employeeId),
      assistants: draft.assistants.filter((item) => item.employeeId !== person.employeeId),
      [field]: [
        ...draft[field].filter((item) => item.employeeId !== person.employeeId),
        selected,
      ],
    });
  };
  const save = async () => {
    if (!editing || !draft) return;
    try {
      if (preview) {
        await saveDispatchPreviewAsFormal(
          [...dayAssignment.blocks, ...nightAssignment.blocks],
          editing.id,
          draft,
          employeeId,
        );
      } else {
        await updateDispatchBlock(editing, draft, employeeId);
      }
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
        <strong>{visible.length} 個派工區塊／{assignment.unmatched.length} 人待人工調整</strong>
      </div>
      <div className="dispatch-import-actions">
        <button className="admin-primary" disabled={importing} onClick={() => setImportDate(date)}>＋ 帶入當日派工單（Google）</button>
        {importMessage && <span role="status">{importMessage}</span>}
      </div>
      {importDate && <Modal title="確定要帶入 Google 當日派工單嗎？" onClose={() => { if (!importing) setImportDate(null); }}>
        <p>日期：{importDate}</p>
        <p>此操作將以 Google 當日派工資料更新目前日期的派工內容，包含人員、車號、駐點與工作重點。</p>
        <div className="settings-actions">
          <button disabled={importing} onClick={() => setImportDate(null)}>取消</button>
          <button className="admin-primary" disabled={importing} onClick={() => void importGoogle()}>{importing ? '帶入中…' : '確認帶入'}</button>
        </div>
      </Modal>}
      {error && <div className="admin-alert">{error}</div>}
      {preview && (
        <div className="admin-preview-note">
          此日期尚未儲存派工，目前顯示班表自動派工預覽；第一次人工修改時才會儲存當日派工。
        </div>
      )}
      {assignment.unmatched.length > 0 && (
        <div className="admin-alert dispatch-pending-summary">
          <strong>待人工調整：{assignment.unmatched.length} 人</strong>
          <button type="button" aria-haspopup="dialog" onClick={() => setShowPending(true)}>查看名單</button>
        </div>
      )}
      {showPending && assignment.unmatched.length > 0 && (
        <Modal title={`待人工調整：${assignment.unmatched.length} 人`} onClose={() => setShowPending(false)}>
          <p>{date} · {shift === 'day' ? '早班' : '夜班'}</p>
          <div className="dispatch-pending-list">
            <table className="admin-data-table">
              <thead><tr><th>員編</th><th>姓名</th><th>班表代碼</th><th>目前區域</th><th>待調整原因</th></tr></thead>
              <tbody>{assignment.unmatched.map((person, index) => {
                const currentAreas = [...new Set(assignedBlocks.filter(block =>
                  [...block.drivers, ...block.stations, ...block.assistants].some(item => item.employeeId === person.employeeId),
                ).map(block => block.areaName || block.areaCode || '特殊派工'))];
                return <tr key={`${person.employeeId}-${person.scheduleCode}-${index}`}>
                  <td>{person.employeeId}</td><td>{person.employeeName}</td><td>{person.scheduleCode}</td>
                  <td>{currentAreas.join('、') || '尚未派工'}</td>
                  <td>{person.reason.replaceAll('block', '派工區塊').replaceAll('variant', '類型')}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </Modal>
      )}
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
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((block) => (
              <tr key={block.id}>
                <td>
                  <b>{block.areaName || '特殊派工'}</b>
                </td>
                <td>{block.vehicleNo || '—'}</td>
                <td>{peopleNames(block.drivers)}</td>
                <td>{peopleNames(block.stations)}</td>
                <td>{peopleNames(block.assistants)}</td>
                <td className="focus-cell"><WorkFocus key={block.workFocus} text={block.workFocus} collapsible /></td>
                <td>
                  <span className={`dispatch-assignment-status status-${block.assignmentStatus}`}>
                    {dispatchAssignmentStatusLabel(block.assignmentStatus)}
                  </span>
                </td>
                <td>
                  <button onClick={() => open(block)}>修改</button>
                  <button onClick={() => void showAudits(block)}>
                    查看紀錄
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
          <section className="dispatch-person-picker">
            <header>
              <div>
                <b>依當日班表選擇人員</b>
                <small>排序依職階，再依員編；加入時會從其他欄位移除同一人。</small>
              </div>
              <input
                placeholder="員編、姓名或職稱"
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
              />
            </header>
            <div>
              {pickerPeople.map((person) => (
                <article key={person.employeeId}>
                  <span>
                    <b>{person.name}</b>
                    <small>{person.title} · {person.employeeId}</small>
                  </span>
                  <div>
                    <button onClick={() => assignPerson(person, 'drivers')}>駕駛</button>
                    <button onClick={() => assignPerson(person, 'stations')}>駐點</button>
                    <button onClick={() => assignPerson(person, 'assistants')}>隨車</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
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
                        { 修改前: readableAudit(audit.before), 修改後: readableAudit(audit.after) },
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
  const [layout, setLayout] = useState<MonthLayout|null>(null);
  const layoutById=useMemo(()=>new Map(layout?.rows.map(row=>[row.employeeId,row]) || []),[layout]);
  const loadRevision=useRef(0);
  const [monthLoading,setMonthLoading]=useState(true);
  const [rowAction, setRowAction] = useState<string|null>(null);
  const [group, setGroup] = useState('day');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<ScheduleRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    const revision=++loadRevision.current;
    setMonthLoading(true);
    try {
      const [rows, people, monthLayout] = await Promise.all([
        listMonthScheduleRecords(month),
        getDocs(collection(db, 'employees')),
        getMonthLayout(month),
      ]);
      if(revision!==loadRevision.current)return;
      setLayout(monthLayout);
      setRecords(rows);
      setEmployees(
        people.docs.map(
          (item) => ({ employeeId: item.id, ...item.data() }) as EmployeeRecord,
        ),
      );
      setError('');
    } catch (cause) {
      if(revision!==loadRevision.current)return;
      console.error('[scheduleManager] load failed', cause);
      setError('班表載入失敗');
    } finally {
      if(revision===loadRevision.current)setMonthLoading(false);
    }
  };
  useEffect(() => {
    setRecords([]);setLayout(null);setRowAction(null);setEditing(null);
    void load();
    return ()=>{loadRevision.current++;};
  }, [month]);
  const days = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const profiles = new Map(
    employees.map((person) => [person.employeeId, person]),
  );
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekdayFor = (day: number) =>
    weekdays[
      new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)) - 1,
        day,
      ).getDay()
    ];
  const rows = useMemo(() => {
    const grouped = new Map<string, ScheduleRecord[]>();
    records.forEach((record) =>
      grouped.set(record.employeeId, [
        ...(grouped.get(record.employeeId) || []),
        record,
      ]),
    );
    if(layout) for(const item of layout.rows) if(!grouped.has(item.employeeId)) grouped.set(item.employeeId,[]);
    return [...grouped]
      .filter(([id])=>!layout || layoutById.has(id))
      .map(([id, items]) => ({ id, employee: profiles.get(id), items }))
      .filter(
        (row) => !search || `${row.id} ${row.employee?.name}`.includes(search),
      );
  }, [records, employees, search, layout, layoutById]);
  const sections = useMemo(() => monthSections(rows, group, layout, row => ({
    ...row.employee, employeeId: row.id, shiftType: row.employee?.shiftType || row.items[0]?.shiftType,
  })), [rows, group, layout]);
  const areas = sections;
  const [editing, setEditing] = useState<{record:ScheduleRecord; person:EmployeeRecord} | null>(null);
  const catalog = useMemo(()=>buildScheduleEditCatalog(records,group),[records,group]);
  const edit = (record:ScheduleRecord | undefined, person:EmployeeRecord | undefined) => {
    if(admin && record && person) setEditing({record,person});
  };
  return (
    <section className="admin-schedule-page">
      <div className="admin-page-toolbar filters">
        <div className="schedule-group-switch" aria-label="正式班表組別">
          <button aria-pressed={group === 'day'} onClick={() => setGroup('day')}>日班</button>
          <button aria-pressed={group === 'night'} onClick={() => setGroup('night')}>大小夜班</button>
        </div>
        <AreaJumpDropdown areas={areas} group={`${month}-${group}`} scope="admin-schedule" scrollTarget={scrollRef} />
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
            ? '點擊班別可修改；儲存時留下修改紀錄'
            : '值班監控僅可查看正式班表'}
        </span>
        {admin&&<button disabled={monthLoading||!!error} onClick={()=>setRowAction('')}>新增人員</button>}
      </div>
      {error && <div className="admin-alert">{error}</div>}
      <div className="admin-schedule-wrap" ref={scrollRef}>
        <table className="admin-schedule" style={{ width: 295 + days * 60 }}>
          <colgroup>
            <col style={{ width: 130 }} />
            <col style={{ width: 75 }} />
            <col style={{ width: 90 }} />
            {Array.from({ length: days }, (_, index) => <col key={index} style={{ width: 60 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th>職稱</th>
              <th>員編</th>
              <th>姓名</th>
              {Array.from({ length: days }, (_, index) => (
                <th className="admin-schedule-date" key={index + 1}>
                  {index + 1}（{weekdayFor(index + 1)}）
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(section => <Fragment key={section.key}>
              <tr className="admin-source-heading" id={scheduleSectionId('admin-schedule',`${month}-${group}`,section.key)} data-area-code={section.areaCode || undefined}><td colSpan={days + 3}><span>{section.label}</span></td></tr>
              {section.people.map((row: typeof rows[number]) => (
              <tr key={row.id} data-employee-id={row.id}>
                <td>{row.employee?.title || '—'}</td>
                <td>{row.id}</td>
                <td>
                  {row.employee?.name || row.items[0]?.employeeName || '—'}
                  {admin&&<button className="schedule-row-action" aria-label={`管理 ${row.id} ${row.employee?.name || ''}`} onClick={()=>setRowAction(row.id)}>⋮</button>}
                </td>
                {Array.from({ length: days }, (_, index) => {
                  const stored = row.items.find(
                    (item) => Number(item.date.slice(8)) === index + 1,
                  );
                  const blank=layoutById.get(row.id)?.blankDays.includes(String(index+1));
                  const record=blank?undefined:stored;
                  const draftRecord=record || {id:`${row.id}_${month}-${String(index+1).padStart(2,'0')}`,employeeId:row.id,employeeName:row.employee?.name || '',date:`${month}-${String(index+1).padStart(2,'0')}`,shiftType:group==='day'?'morning':'night',scheduleCode:'',scheduleLabel:'',leaveType:'',source:'admin-month-schedule',status:'active',note:'',modifiedBy:''} as ScheduleRecord;
                  return (
                    <td
                      key={index}
                      data-date-column="true"
                      className={
                        `admin-schedule-date ${isLeave(record?.scheduleCode || '') ? 'leave-cell' : ''}`
                      }
                    >
                      <button
                        disabled={!admin || (!record && !layoutById.has(row.id))}
                        onClick={() =>
                          edit(draftRecord, row.employee)
                        }
                      >
                        {record?.scheduleCode || '—'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}</Fragment>)}
          </tbody>
        </table>
      </div>
      {rowAction!==null&&<MonthRowManager month={month} layout={layout} people={employees} present={layout?.rows.map(r=>r.employeeId) || [...new Set(records.map(r=>r.employeeId))]} selected={rowAction || undefined} onClose={()=>setRowAction(null)} onSaved={load} />}
      {editing && <ScheduleCellEditor employeeId={editing.person.employeeId} name={editing.person.name} date={editing.record.date} currentCode={editing.record.scheduleCode} catalog={catalog} onClose={()=>setEditing(null)} onSave={async code=>{if(!catalog.leaves.includes(code) && !catalog.special.includes(code) && !catalog.areas.some(area=>area.codes.includes(code))) throw new Error('請選擇既有正式班碼');const row=layout?.rows.find(r=>r.employeeId===editing.person.employeeId);if(row&&(row.blankDays.includes(String(Number(editing.record.date.slice(8))))||!records.some(r=>r.id===editing.record.id)))await manageMonthRow({action:'cell',monthKey:month,revision:layout?.revision,employeeId:editing.person.employeeId,date:editing.record.date,code});else await updateFormalScheduleCell(editing.record,code,employeeId);await load();}} />}
    </section>
  );
}

function AnnouncementManager({ employeeId }: { employeeId: string }) {
  const [current, setCurrent] = useState<AnnouncementImage | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      setCurrent(await getCurrentAnnouncement());
      setMessage('');
    } catch (error) {
      console.error('[announcementAdmin] load failed', error);
      setMessage('公告圖片載入失敗');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadCurrentAnnouncement(
        file,
        employeeId,
      );
      setCurrent(uploaded);
      setFile(null);
      setMessage('公告圖片已更新');
    } catch (error) {
      console.error('[announcementAdmin] upload failed', error);
      setMessage(error instanceof Error ? error.message : '公告圖片上傳失敗');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm('確定移除目前公告圖片並恢復預設公告？')) return;
    setBusy(true);
    try {
      await removeCurrentAnnouncement(current, employeeId);
      setCurrent(null);
      setFile(null);
      setMessage('公告圖片已移除，前台將顯示預設公告');
    } catch (error) {
      console.error('[announcementAdmin] remove failed', error);
      setMessage('公告圖片移除失敗');
    } finally {
      setBusy(false);
    }
  };
  const imageUrl = previewUrl || current?.imageUrl || '';
  return (
    <div className="announcement-admin-layout">
      <section className="admin-panel settings-panel">
        <header>
          <h2>公告圖片上傳</h2>
        </header>
        <div className="announcement-upload-controls">
          <label>
            {current?.imageUrl ? '更換圖片' : '選擇圖片'}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <small>支援一般圖片格式，單檔上限 12 MB；系統會自動等比例縮圖，前台不裁切內容。</small>
          <div className="settings-actions">
            <button
              className="admin-primary"
              disabled={!file || busy}
              onClick={() => void upload()}
            >
              {busy ? '處理中…' : '上傳'}
            </button>
            <button disabled={!current?.imageUrl || busy} onClick={() => void remove()}>
              移除
            </button>
          </div>
          {current?.originalName && <p>目前檔案：{current.originalName}</p>}
          {message && <p className="admin-role-note">{message}</p>}
        </div>
      </section>
      <section className="admin-panel announcement-preview-panel">
        <header>
          <h2>前台顯示預覽</h2>
        </header>
        <div>
          {imageUrl ? (
            <img src={imageUrl} alt="公告圖片預覽" />
          ) : (
            <p>目前使用系統預設公告圖片。</p>
          )}
        </div>
      </section>
    </div>
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
          title: String(item.data().title || ''),
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
      `${person.employeeId} ${person.name} ${person.title}`.includes(personSearch),
    )
    .sort(employeeAdminOrder)
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
            {admin ? '可新增、修改、複製、停用與刪除' : '值班監控僅可查看'}
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
                  {targetTypeLabels[item.targetType] || '指定對象'}
                  <small>{item.targetValues?.join('、')}</small>
                </td>
                <td>{popupModeLabels[item.popupMode] || '僅在列表顯示'}</td>
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
                <option value="once">只顯示一次</option>
                <option value="daily">每天一次</option>
                <option value="always">每次開啟</option>
                <option value="none">僅在列表顯示</option>
              </select>
            </label>
            <label>
              圖片網址
              <input
                value={draft.imageUrl}
                onChange={(event) =>
                  setDraft({ ...draft, imageUrl: event.target.value })
                }
              />
            </label>
            <label>
              連結網址
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
  const visible = items
    .filter(
      (item) =>
        (!search || `${item.employeeId} ${item.name}`.includes(search)) &&
        (!title ||
          (title === '其他'
            ? !isStandardAdminTitle(item.title)
            : item.title === title)) &&
        (!role || item.role === role) &&
        (!active || String(item.active) === active) &&
        (!shift || shiftMap.get(item.employeeId)?.has(shift)),
    )
    .sort(employeeAdminOrder);
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
            {[...ADMIN_TITLE_OPTIONS, '其他'].map((value) => (
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
          權限
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="">全部</option>
            <option value="employee">一般員工</option>
            <option value="duty">值班監控</option>
            <option value="admin">管理員</option>
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
              <th>權限</th>
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
                <td>{permissionLabel(item.role)}</td>
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
              <select
                value={isStandardAdminTitle(editing.title) ? editing.title : '其他'}
                onChange={(event) =>
                  setEditing({ ...editing, title: event.target.value })
                }
              >
                {[...ADMIN_TITLE_OPTIONS, '其他'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              {!isStandardAdminTitle(editing.title) && (
                <input
                  placeholder="輸入其他職稱"
                  value={editing.title === '其他' ? '' : editing.title}
                  onChange={(event) =>
                    setEditing({ ...editing, title: event.target.value || '其他' })
                  }
                />
              )}
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
              權限
              <select
                value={editing.role}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    role: event.target.value as EmployeeRecord['role'],
                  })
                }
              >
                <option value="employee">一般員工</option>
                <option value="duty">值班監控</option>
                <option value="admin">管理員</option>
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
  const [saving,setSaving]=useState(false), [savedAt,setSavedAt]=useState(''), [saveMessage,setSaveMessage]=useState('');
  const load = async () => {
    const snapshot = await getDoc(doc(db, 'scheduleSettings', month));
    if (snapshot.exists()) {
      const data = snapshot.data();
      setStartAt(datetimeValue(data.startAt));
      setEndAt(datetimeValue(data.endAt));
      setStatus(data.status || 'scheduled');
      setSavedAt(data.updatedAt?.toDate?.().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}) || '');
    } else {
      setSavedAt('');
      setStartAt('');
      setEndAt('');
      setStatus('scheduled');
    }
  };
  useEffect(() => {
    void load().catch(error=>{console.error('[scheduleSettings] load failed',error);setSaveMessage('設定載入失敗');});
  }, [month]);
  const save = async (nextStatus = status) => {
    setSaving(true);setSaveMessage('儲存中…');
    try {
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
    await load();setSaveMessage('已儲存');
    } catch(error) {console.error('[scheduleSettings] save failed',error);setSaveMessage('儲存失敗，請稍後再試');} finally {setSaving(false);}
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
        <div className="settings-actions" aria-busy={saving}>
          <button disabled={saving} className="admin-primary" onClick={() => void save()}>
            儲存時間
          </button>
          <button disabled={saving} onClick={() => void save('open')}>立即開放／重新開放</button>
          <button disabled={saving} onClick={() => void save('closed')}>立即關閉</button>
          <button disabled={saving} onClick={extendOneDay}>延長 1 天</button>
        </div>
        <p className="settings-save-status" role="status">{saveMessage}{savedAt && ` · 最後儲存時間：${savedAt}`}</p>
        <p>
          開放期間由管理員設定，不寫死每月 10～20 日；按「延長 1
          天」後再儲存即可生效。
        </p>
      </section>
    </div>
  );
}

function SystemSettings({employeeId}:{employeeId:string}) { return <SystemFeatureSettings employeeId={employeeId} />; }

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
