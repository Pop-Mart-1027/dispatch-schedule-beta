'use client';
import { Fragment, useEffect, useMemo, useState, useRef } from 'react';
import { titleAdminOrder } from '../lib/admin-employee-order';
import {
  preScheduleDisplayOrder,
  preScheduleSource,
  scheduleSections,
} from '../functions/pre-schedule-order.mjs';
import {
  PRE_CHOICES,
  monthDays,
  reviewedDays,
  assessArrangement,
  mayReview,
  effectiveMonthStatus,
  usePreScheduleClock,
  preCall,
  preTime,
  nextPreMonth,
  preError,
  type PreGroup,
  type PreEntry,
  type PrePerson,
  type PreSummary,
  type PreProgress,
} from '../lib/pre-schedule';
import './pre-schedule-admin.css';

export function PreScheduleAdmin({ admin }: { admin: boolean }) {
  const [month, setMonth] = useState(nextPreMonth),
    [publishing, setPublishing] = useState(false);
  return (
    <div className="pre-month-workspace">
      <div className="admin-page-toolbar">
        <h2>整月預排管理</h2>
        <label>
          預排月份
          <input
            disabled={publishing}
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </label>
      </div>
      <MonthMatrix
        key={month}
        month={month}
        admin={admin}
        onPublishing={setPublishing}
      />
    </div>
  );
}
function MonthMatrix({
  month,
  admin,
  onPublishing,
}: {
  month: string;
  admin: boolean;
  onPublishing: (value: boolean) => void;
}) {
  const [group, setGroup] = useState<'day' | 'night'>('day'),
    [data, setData] = useState<PreGroup | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  const [search, setSearch] = useState(''),
    [title, setTitle] = useState(''),
    [filter, setFilter] = useState('all');
  const clock = usePreScheduleClock(data?.month);
  const [edit, setEdit] = useState<{
      person: PrePerson;
      entry: PreEntry;
      index: number;
    } | null>(null),
    [value, setValue] = useState(''),
    [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<PreSummary | null>(null),
    [warnings, setWarnings] = useState(false),
    [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState<PreProgress | null>(null);
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const matrixRef = useRef<HTMLDivElement>(null);
  const filterUnarranged = (targetGroup = group) => {
    setSummary(null);
    setSearch('');
    setTitle('');
    setGroup(targetGroup);
    setFilter('unarranged');
  };
  useEffect(() => {
    if (filter === 'unarranged' && !loading)
      matrixRef.current
        ?.querySelector('[data-unarranged="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [filter, loading, data]);
  useEffect(() => {
    onPublishing(running);
    const warn = (e: BeforeUnloadEvent) => {
      if (running) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running, onPublishing]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setEdit(null);
    preCall<PreGroup>('group', month, { group })
      .then((result) => {
        if (active) setData(result);
      })
      .catch(async (e) => {
        if (!active) return;
        // An unconfigured month has no entries yet; still expose existing period settings.
        try {
          const context = await preCall<PreGroup>('context', month);
          if (active) {
            setData({ ...context, roster: [], entries: [] });
            if (context.month) setError(preError(e));
          }
        } catch (cause) {
          if (active) setError(preError(cause));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, group, version]);
  useEffect(() => {
    const format = (time: number | null | undefined) =>
      time ? new Date(time + 8 * 3600000).toISOString().slice(0, 16) : '';
    setStart(format(data?.month?.openAt || data?.settings?.startAt));
    setEnd(format(data?.month?.closeAt || data?.settings?.endAt));
  }, [
    data?.month?.openAt,
    data?.month?.closeAt,
    data?.settings?.startAt,
    data?.settings?.endAt,
  ]);
  const entries = new Map(data?.entries.map((e) => [e.employeeId, e]) || []);
  const rows = useMemo(() => {
    const byId = new Map(data?.entries.map((e) => [e.employeeId, e]) || []);
    return (data?.roster || [])
      .map((person) => {
        const entry = byId.get(person.employeeId);
        return {
          person,
          entry,
          checks: assessArrangement(month, entry, data?.formalCodes || []),
        };
      })
      .sort((a, b) => preScheduleDisplayOrder(a.person, b.person));
  }, [data, month]);
  const stats = {
    expected: rows.length,
    submitted: rows.filter((r) => r.entry?.submitted).length,
    unsubmitted: rows.filter((r) => !r.entry?.submitted).length,
    incomplete: rows.filter((r) => r.checks.incomplete).length,
    abnormal: rows.filter((r) => r.checks.abnormal).length,
    unarranged: rows.reduce((n, r) => n + r.checks.unarranged, 0),
  };
  const visible = rows.filter(
    (r) =>
      (!search || `${r.person.employeeId} ${r.person.name}`.includes(search)) &&
      (!title || r.person.title === title) &&
      (filter === 'all' ||
        (filter === 'submitted' && r.entry?.submitted) ||
        (filter === 'unsubmitted' && !r.entry?.submitted) ||
        (filter === 'incomplete' && r.checks.incomplete) ||
        (filter === 'abnormal' && r.checks.abnormal) ||
        (filter === 'unarranged' && r.checks.unarranged > 0)),
  );
  const canEdit =
    !!data?.month && mayReview(data.month, clock) && !loading && !running;
  const sections = scheduleSections(visible, group, row => row.person);
  const reload = () => setVersion((v) => v + 1);
  const configure = async (status: 'open' | 'locked') => {
    setSaving(true);
    setError('');
    try {
      await preCall('configure', month, {
        status,
        openAt: Date.parse(`${start}:00+08:00`),
        closeAt: Date.parse(`${end}:00+08:00`),
      });
      reload();
    } catch (e) {
      setError(preError(e));
    } finally {
      setSaving(false);
    }
  };
  const openCell = (person: PrePerson, index: number) => {
    if (!canEdit) return;
    const entry = entries.get(person.employeeId) || {
      employeeId: person.employeeId,
      employeeName: person.name,
      jobTitle: person.title,
      group: person.group,
      days: Array(monthDays(month)).fill(''),
      note: '',
      submitted: false,
      submittedAt: null,
      updatedAt: null,
      revision: 0,
    };
    setEdit({ person, entry, index });
    setValue(reviewedDays(month, entry)[index]);
  };
  const saveCell = async () => {
    if (!edit) return;
    setSaving(true);
    setError('');
    try {
      const arrangedDays = (
        edit.entry.arrangedDays || Array(monthDays(month)).fill(null)
      ).map((d, i) => (i === edit.index ? value : d));
      const result = await preCall<{ entry: PreEntry }>('review', month, {
        employeeId: edit.person.employeeId,
        arrangedDays,
        note: edit.entry.note,
        revision: edit.entry.revision,
      });
      setData((old) =>
        old
          ? {
              ...old,
              entries: [
                ...old.entries.filter(
                  (e) => e.employeeId !== result.entry.employeeId,
                ),
                result.entry,
              ],
            }
          : old,
      );
      setEdit(null);
    } catch (e) {
      setError(preError(e));
    } finally {
      setSaving(false);
    }
  };
  const showSummary = async () => {
    setSaving(true);
    setError('');
    try {
      setSummary(await preCall<PreSummary>('summary', month));
      setWarnings(false);
      setOverwrite(false);
    } catch (e) {
      setError(preError(e));
    } finally {
      setSaving(false);
    }
  };
  const continueJob = async (job: PreProgress) => {
    let current = job;
    setProgress(current);
    while (current.next < current.total) {
      current = await preCall<PreProgress>('continue', month, {
        jobId: current.jobId,
        next: current.next,
      });
      setProgress(current);
    }
    setSummary(null);
    reload();
  };
  const publish = async () => {
    if (!summary) return;
    setRunning(true);
    setError('');
    try {
      const job = await preCall<PreProgress>('publish', month, {
        confirmed: true,
        fingerprint: summary.fingerprint,
        acknowledgeWarnings: warnings,
        overwriteMonth: overwrite ? month : '',
      });
      await continueJob(job);
    } catch (e) {
      setError(preError(e));
      reload();
    } finally {
      setRunning(false);
    }
  };
  const resume = async () => {
    setRunning(true);
    setError('');
    try {
      const job = await preCall<PreProgress | null>('progress', month);
      if (job?.ready) await continueJob(job);
      else setError('發布計畫尚未完成，可取消尚未寫入的準備作業後重新確認');
    } catch (e) {
      setError(preError(e));
    } finally {
      setRunning(false);
    }
  };
  return (
    <section className="pre-month-admin">
      <div className="admin-page-toolbar">
        <div className="pre-group-tabs" role="tablist" aria-label="預排組別">
          <button
            role="tab"
            aria-selected={group === 'day'}
            disabled={running}
            onClick={() => {
              setSearch('');
              setTitle('');
              setFilter('all');
              setGroup('day');
            }}
          >
            日班
          </button>
          <button
            role="tab"
            aria-selected={group === 'night'}
            disabled={running}
            onClick={() => {
              setSearch('');
              setTitle('');
              setFilter('all');
              setGroup('night');
            }}
          >
            大小夜班
          </button>
        </div>
        <span>依原班表編制與車組順序排列；大小夜班包含夜班與小夜班</span>
        <button onClick={reload} disabled={running}>
          重新載入
        </button>
      </div>
      <p>
        開放：{preTime(data?.month?.openAt)}　截止：
        {preTime(data?.month?.closeAt)}　狀態：
        {
          (
            {
              open: '開放中',
              locked: '已鎖定',
              reviewing: '整理中',
              published: '已發布',
            } as Record<string, string>
          )[data?.month ? effectiveMonthStatus(data.month, clock) : 'locked']
        }
      </p>
      {admin && (
        <details className="pre-month-settings">
          <summary>月份開放／鎖定與期限設定</summary>
          <label>
            開放時間（台北）
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            截止時間（台北）
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            disabled={saving || running || !start || !end}
            onClick={() => void configure('open')}
          >
            開放／儲存期限
          </button>
          <button
            disabled={saving || running || !start || !end}
            onClick={() => void configure('locked')}
          >
            鎖定月份
          </button>
        </details>
      )}
      {error && (
        <div role="alert" className="admin-alert">
          {error}
        </div>
      )}
      {!data?.month && !loading && (
        <p>
          此月份尚未建立，請管理員設定期限並開放月份；既有設定會自動帶入，不寫死每月日期。
        </p>
      )}
      <div className="pre-month-stats">
        {[
          ['應預排人數', stats.expected],
          ['已送出人數', stats.submitted],
          ['未送出人數', stats.unsubmitted],
          ['未完整人數', stats.incomplete],
          ['異常人數', stats.abnormal],
        ].map(([label, n]) => (
          <div className="admin-stat" key={label}>
            <span>{label}</span>
            <strong>{loading ? '…' : n}</strong>
          </div>
        ))}
      </div>
      {!loading && stats.unarranged > 0 && (
        <div className="admin-alert">
          <strong>
            尚有 {stats.unarranged} 個出勤班次未完成班別／區域安排
          </strong>
          （目前組別）{' '}
          <button onClick={() => filterUnarranged()}>查看未安排格子</button>
        </div>
      )}
      <div className="admin-page-toolbar">
        <input
          aria-label="搜尋預排員工"
          placeholder="員編／姓名"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="預排職稱"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        >
          <option value="">全部職稱</option>
          {[...new Set(rows.map((r) => r.person.title))]
            .sort(titleAdminOrder)
            .map((t) => (
              <option key={t}>{t}</option>
            ))}
        </select>
        <select
          aria-label="預排狀態"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {[
            ['all', '全部'],
            ['submitted', '已送出'],
            ['unsubmitted', '未送出'],
            ['incomplete', '未完成'],
            ['abnormal', '異常'],
            ['unarranged', '出勤未安排'],
          ].map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
        <span>
          {canEdit
            ? '可點選日期整理預排（不修改正式班表）'
            : '唯讀：截止後才開放整理'}
        </span>
        {admin &&
          data?.month &&
          data.month.status !== 'published' &&
          !data.month.publishJob && (
            <button
              className="admin-primary"
              disabled={saving || running}
              onClick={() => void showSummary()}
            >
              轉為正式班表
            </button>
          )}
      </div>
      {admin && data?.month?.publishJob && !running && (
        <div className="admin-alert">
          發布尚未完成，預排暫時鎖定。
          <button onClick={() => void resume()}>繼續發布</button>
          <button
            onClick={() => {
              if (window.confirm('只取消尚未寫入正式班表的準備作業？'))
                void preCall('cancelPreparation', month)
                  .then(reload)
                  .catch((e) => setError(preError(e)));
            }}
          >
            取消未開始的發布
          </button>
        </div>
      )}
      {progress && (
        <p role="status">
          發布進度：{progress.next}／{progress.total} 批；共 {progress.records}{' '}
          筆正式班表{running ? '，請勿重複操作' : ''}
        </p>
      )}
      <div className="pre-month-scroll" ref={matrixRef}>
        <table className="pre-month-table">
          <thead>
            <tr>
              <th>職稱</th>
              <th>員編</th>
              <th>姓名</th>
              {Array.from({ length: monthDays(month) }, (_, i) => (
                <th key={i}>
                  {i + 1}（
                  {
                    '日一二三四五六'[
                      new Date(
                        `${month}-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
                      ).getUTCDay()
                    ]
                  }
                  ）
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              sections.map(section => (
                <Fragment key={section.key}>
                  {section.people.some((row: typeof rows[number]) => preScheduleSource(row.person.employeeId)) && (
                      <tr className="pre-source-heading" data-area-code={section.areaCode || undefined}>
                        <td colSpan={monthDays(month) + 3}>
                          <span>
                            {section.label}
                          </span>
                        </td>
                      </tr>
                    )}
                  {section.people.map(({ person, entry, checks }: typeof rows[number]) => <tr key={person.employeeId} data-employee-id={person.employeeId}>
                    <td>{person.title}</td>
                    <td>{person.employeeId}</td>
                    <td title={checks.issues.join('；')}>
                      <strong>{person.name}</strong>
                      <small>
                        {entry?.submitted ? '已送出' : '未送出'}
                        {checks.incomplete ? ' · 未完成' : ''}
                        {checks.abnormal ? ' · 異常' : ''}
                      </small>
                    </td>
                    {Array.from({ length: monthDays(month) }, (_, i) => (
                      <td
                        key={i}
                        className={
                          checks.pendingIndices.includes(i)
                            ? 'pre-unarranged'
                            : ''
                        }
                        data-unarranged={
                          checks.pendingIndices.includes(i) ? 'true' : undefined
                        }
                      >
                        <button
                          disabled={!canEdit || saving}
                          aria-label={`${person.employeeId} ${i + 1}日`}
                          onClick={() => openCell(person, i)}
                          title={`員工預排：${entry?.days[i] || '未填'}${checks.pendingIndices.includes(i) ? '；待監控安排正式班碼' : ''}`}
                        >
                          {checks.days[i] || '—'}
                        </button>
                      </td>
                    ))}
                  </tr>)}
                </Fragment>
              ))}
          </tbody>
        </table>
        {loading && <p>載入整組預排中…</p>}
      </div>
      {edit && (
        <div className="admin-modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="整理預排"
            className="admin-modal"
          >
            <h3>
              {edit.person.employeeId} {edit.person.name} · {month}-
              {edit.index + 1}
            </h3>
            <p>
              員工預排：{edit.entry.days[edit.index] || '未填'}（保留原始需求）
            </p>
            <label>
              整理後正式班碼
              <select
                aria-label="整理後正式班碼"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">未排</option>
                <optgroup label="預排／休假選項">
                  {PRE_CHOICES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </optgroup>
                <optgroup label="既有正式班碼">
                  {(data?.formalCodes || []).map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <p>選「上班」仍屬待安排；請選用正式班碼，休／例／假別不需區碼。</p>
            {!data?.formalCodes?.length && (
              <p role="alert">
                尚無可用正式班碼，請確認既有正式班表來源；不可自行猜測區碼。
              </p>
            )}
            <button disabled={saving} onClick={() => void saveCell()}>
              儲存並留下修改紀錄
            </button>
            <button disabled={saving} onClick={() => setEdit(null)}>
              取消
            </button>
          </section>
        </div>
      )}
      {summary && (
        <div className="admin-modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="發布摘要"
            className="admin-modal"
          >
            <h3>轉為正式班表：{summary.monthKey}</h3>
            <p>
              日班 {summary.day} 人／大小夜班 {summary.night} 人
            </p>
            <p>
              尚未送出 {summary.unsubmitted}／未完成 {summary.incomplete}／異常{' '}
              {summary.abnormal}
            </p>
            <p>發布採用監控整理後的正式班碼，員工原始預排需求另行保留。</p>
            {summary.unarrangedWorkDays > 0 && (
              <div className="admin-alert">
                <strong>
                  尚有 {summary.unarrangedWorkDays}{' '}
                  個出勤班次未完成班別／區域安排
                </strong>
                <p>
                  日班 {summary.unarrangedGroups.day}／大小夜班{' '}
                  {summary.unarrangedGroups.night}
                </p>
                <button
                  onClick={() =>
                    filterUnarranged(
                      summary.unarrangedGroups.day > 0 ? 'day' : 'night',
                    )
                  }
                >
                  查看未安排格子
                </button>
              </div>
            )}
            {summary.blocking > 0 && (
              <div className="admin-alert">
                尚有未完整或識別異常，請先完成整理再發布。
              </div>
            )}
            {(summary.abnormal > 0 || summary.unsubmitted > 0) && (
              <label>
                <input
                  type="checkbox"
                  checked={warnings}
                  onChange={(e) => setWarnings(e.target.checked)}
                />
                我已確認未送出及異常警告
              </label>
            )}
            {summary.existingCount > 0 && (
              <div className="admin-alert">
                <strong>此月份已有正式班表</strong>
                <p>
                  既有 {summary.existingCount}{' '}
                  筆；只更新本次名單對應的員編日期，其餘保留。
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  再次確認覆蓋 {summary.monthKey} 的對應正式班表
                </label>
              </div>
            )}
            <p>
              整月分批寫入；中斷可繼續，全部完成才標記已發布。發布期間請勿另行修改正式班表。
            </p>
            <button
              className="admin-primary"
              disabled={
                running ||
                summary.blocking > 0 ||
                summary.unarrangedWorkDays > 0 ||
                ((summary.abnormal > 0 || summary.unsubmitted > 0) &&
                  !warnings) ||
                (summary.existingCount > 0 && !overwrite)
              }
              onClick={() => void publish()}
            >
              確認轉為正式班表
            </button>
            <button disabled={running} onClick={() => setSummary(null)}>
              取消
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
