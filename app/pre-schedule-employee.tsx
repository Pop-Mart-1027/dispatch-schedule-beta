'use client';
import { useEffect, useRef, useState } from 'react';
import {
  PRE_CHOICES,
  monthDays,
  assessDays,
  mayEmployeeEdit,
  usePreScheduleClock,
  preCall,
  preMonthLabel,
  preTime,
  nextPreMonth,
  preError,
  type PreContext,
  type PreEntry,
} from '../lib/pre-schedule';

export function EmployeePreSchedule({
  cellStyle,
}: {
  cellStyle: (value: string) => string;
}) {
  const [month, setMonth] = useState(nextPreMonth);
  return (
    <EmployeeMonth
      key={month}
      month={month}
      onMonth={setMonth}
      cellStyle={cellStyle}
    />
  );
}
function EmployeeMonth({
  month,
  onMonth,
  cellStyle,
}: {
  month: string;
  onMonth: (value: string) => void;
  cellStyle: (value: string) => string;
}) {
  const [context, setContext] = useState<PreContext | null>(null),
    [days, setDays] = useState<string[]>(() =>
      Array(monthDays(month)).fill(''),
    );
  const [note, setNote] = useState(''),
    [tool, setTool] = useState('上班'),
    [activeDay, setActiveDay] = useState(0);
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const clock = usePreScheduleClock(context?.month),
    [conflict, setConflict] = useState(false);
  const revision = useRef(0),
    generation = useRef(0),
    busy = useRef(false),
    alive = useRef(true);
  const pending = useRef(false),
    flush = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Flush the latest draft on internal navigation as well as on the debounce.
      // A running request drains newer edits when its revision becomes available.
      queueMicrotask(() => {
        if (!alive.current && pending.current && !busy.current)
          void flush.current();
      });
    };
  }, []);
  useEffect(() => {
    let active = true;
    preCall<PreContext>('context', month)
      .then((data) => {
        if (!active) return;
        setContext(data);
        revision.current = data.entry?.revision || 0;
        setDays(data.entry?.days || Array(monthDays(month)).fill(''));
        setNote(data.entry?.note || '');
      })
      .catch((e) => {
        if (active) setError(preError(e));
      });
    return () => {
      active = false;
    };
  }, [month]);
  const editable =
    !!context?.month && mayEmployeeEdit(context.month, clock) && !conflict;
  const checks = assessDays(month, days);
  const save = async (submit = false) => {
    if (busy.current || !editable) return;
    busy.current = true;
    if (alive.current) {
      setSaving(true);
      setError('');
    }
    const version = generation.current;
    let succeeded = false;
    try {
      const result = await preCall<{ entry: PreEntry }>('save', month, {
        days,
        note,
        revision: revision.current,
        ownerId: context?.ownerId,
        submit,
      });
      revision.current = result.entry.revision;
      succeeded = true;
      if (version === generation.current) pending.current = false;
      if (alive.current) {
        setContext((old) => (old ? { ...old, entry: result.entry } : old));
        if (!pending.current) setDirty(false);
        setMessage(submit ? '已送出預排' : '已自動儲存');
      }
    } catch (e) {
      console.error('[preSchedule] 儲存失敗', e);
      if (alive.current) {
        setError(preError(e));
        setConflict(true);
      }
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
      if (succeeded && !alive.current && pending.current) void flush.current();
    }
  };
  flush.current = () => save();
  useEffect(() => {
    if (!dirty || !editable || saving) return;
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [days, note, dirty, editable, saving]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || saving) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);
  const change = (index: number) => {
    if (!editable) return;
    generation.current++;
    pending.current = true;
    setActiveDay(index);
    setDays((old) => old.map((v, i) => (i === index ? tool : v)));
    setDirty(true);
    setMessage('尚有變更待儲存');
  };
  const offset = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  return (
    <section className="pre-card">
      <label>
        預排月份
        <input
          aria-label="預排月份"
          type="month"
          value={month}
          onChange={(e) => {
            if (
              e.target.value &&
              (!(dirty || saving) ||
                window.confirm('仍有未儲存內容，確定切換月份？'))
            )
              onMonth(e.target.value);
          }}
        />
      </label>
      <h2 className="plan-month">{preMonthLabel(month)}</h2>
      <p>
        開放：{preTime(context?.month?.openAt)}　截止：
        {preTime(context?.month?.closeAt)}
      </p>
      <p role="status">
        {context?.entry?.submitted ? '已送出' : '尚未送出'} ·{' '}
        {saving ? '儲存中…' : message}
      </p>
      {!context && !error && <p>載入預排中…</p>}
      {context && !context.month && <p>此月份尚未開放預排。</p>}
      {context?.month && !editable && (
        <p>
          目前唯讀：
          {context.month.status === 'published'
            ? '已發布正式班表'
            : '尚未開放、已鎖定或已截止'}
          。未儲存內容不會冒充已儲存。
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button onClick={() => window.location.reload()}>重新載入</button>
        </p>
      )}
      <div className="plan-tools">
        <div>
          {PRE_CHOICES.map((choice) => (
            <button
              disabled={!editable}
              key={choice}
              aria-pressed={tool === choice}
              onClick={() => setTool(choice)}
              className={tool === choice ? 'choice active' : 'choice'}
            >
              {choice}
            </button>
          ))}
          <button
            disabled={!editable}
            className={tool === '' ? 'choice active' : 'choice'}
            onClick={() => setTool('')}
          >
            清除
          </button>
        </div>
      </div>
      <div className="month-grid">
        {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
          <div className="weekday" key={w}>
            {w}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((value, index) => (
          <button
            key={index}
            disabled={!editable}
            aria-label={`${index + 1}日 ${value || '未排'}`}
            onClick={() => change(index)}
            className={`month-day ${activeDay === index ? 'selected' : ''} ${cellStyle(value)}`}
          >
            <small>{index + 1}</small>
            <strong>{value || '—'}</strong>
          </button>
        ))}
      </div>
      <label>
        備註
        <textarea
          disabled={!editable}
          value={note}
          maxLength={2000}
          onChange={(e) => {
            generation.current++;
            pending.current = true;
            setNote(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      {checks.issues.length > 0 && <p>預排檢查：{checks.issues.join('；')}</p>}
      <button
        className="primary"
        disabled={!editable || saving || !checks.canSubmit}
        onClick={() => void save(true)}
      >
        送出預排
      </button>
      <p>截止前仍可修改已送出的預排，最新修改會自動儲存。</p>
    </section>
  );
}
