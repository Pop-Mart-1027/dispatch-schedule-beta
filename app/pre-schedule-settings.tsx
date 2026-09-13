'use client';
import { useEffect, useRef, useState } from 'react';
import { mayEmployeeEdit, nextPreMonth, preCall, preError, preTime, usePreScheduleClock, type PreContext } from '../lib/pre-schedule';
import { parsePreWindowInput, preReopenDeadline, preWindowConfiguration, preWindowInput } from '../lib/pre-schedule-window';

export function PreScheduleSettings(_props: { employeeId: string }) {
  const [month, setMonth] = useState(nextPreMonth);
  const [context, setContext] = useState<PreContext | null>(null);
  const [startAt, setStartAt] = useState(''), [endAt, setEndAt] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [showCutoff, setShowCutoff] = useState(false);
  const [hour, setHour] = useState(''), [minute, setMinute] = useState('');
  const [reopenNow, setReopenNow] = useState(0);
  const deadline = hour && minute ? preReopenDeadline(hour, minute, reopenNow) : null;
  const busy = useRef(false);
  const clock = usePreScheduleClock(context?.month);
  const apply = (data: PreContext) => {
    setContext(data);
    setStartAt(preWindowInput(data.month?.openAt ?? data.settings?.startAt));
    setEndAt(preWindowInput(data.month?.closeAt ?? data.settings?.endAt));
  };
  useEffect(() => {
    let active = true;
    setLoading(true); setContext(null); setStartAt(''); setEndAt(''); setError(''); setMessage('');
    void preCall<PreContext>('context', month).then(data => {
      if (active) apply(data);
    }).catch(reason => {
      console.error('[preScheduleSettings] load failed', reason);
      if (active) setError(preError(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);
  const protectedMonth = Boolean(context?.month?.publishJob || context?.month?.status === 'published');
  const disabled = loading || saving || !context || protectedMonth;
  const open = Boolean(context?.month && mayEmployeeEdit(context.month, clock));
  const locked = context?.month?.status === 'locked' || context?.settings?.status === 'closed';
  const statusText = loading ? '載入中' : !context ? '無法確認' : protectedMonth ? '發布中／已發布'
    : !context.month ? '尚未初始化' : open ? '開放中' : locked ? '已關閉'
    : context.month.closeAt && clock >= context.month.closeAt ? '已截止' : '尚未到開放時間';
  const save = async (action: 'save' | 'open' | 'close', cutoff = endAt) => {
    if (disabled || busy.current) return;
    busy.current = true; setSaving(true); setError(''); setMessage('儲存中…');
    try {
      const values = preWindowConfiguration(startAt, cutoff, action, locked);
      // Existing admin callable atomically configures the month, roster and period.
      // Do not bypass published-month guards with a direct settings write.
      const result = await preCall<PreContext>('configure', month, values);
      apply(result);
      setShowCutoff(false);
      setMessage('已儲存，前台將依相同月份與時間判斷開放');
    } catch (reason) {
      console.error('[preScheduleSettings] save failed', reason);
      setMessage(''); setError(preError(reason));
    } finally { busy.current = false; setSaving(false); }
  };
  const extendOneDay = () => {
    try {
      setEndAt(preWindowInput((endAt ? parsePreWindowInput(endAt) : Date.now()) + 86400000));
      setError(''); setMessage('截止時間已延長，請按儲存時間');
    } catch (reason) { setError(preError(reason)); }
  };
  const chooseCutoff = () => {
    setReopenNow(Date.now()); setHour(''); setMinute(''); setError(''); setShowCutoff(true);
  };
  return <><div className="settings-grid"><section className="admin-panel settings-panel">
    <header><h2>預排班開放設定</h2><span className={`setting-status ${open ? 'open' : locked ? 'closed' : 'scheduled'}`}>{statusText}</span></header>
    <label>目標排班月份<input type="month" value={month} disabled={saving || showCutoff} onChange={event => event.target.value && setMonth(event.target.value)} /></label>
    <label>開放時間<input type="datetime-local" value={startAt} disabled={disabled} onChange={event => setStartAt(event.target.value)} /></label>
    <label>截止時間<input type="datetime-local" value={endAt} disabled={disabled} onChange={event => setEndAt(event.target.value)} /></label>
    <div className="settings-actions" aria-busy={saving}>
      <button disabled={disabled} className="admin-primary" onClick={() => void save('save')}>儲存時間</button>
      <button disabled={disabled} onClick={chooseCutoff}>立即開放／重新開放</button>
      <button disabled={disabled} onClick={() => void save('close')}>立即關閉</button>
      <button disabled={disabled} onClick={extendOneDay}>延長 1 天</button>
    </div>
    <p className="settings-save-status" role="status">{message}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <p>時間皆為台灣時間。立即開放會先讓你選擇截止時刻，確認後從現在開始開放。延長後請再儲存；已關閉月份請按重新開放。</p>
  </section></div>
  {showCutoff && <div className="admin-modal-backdrop"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="pre-cutoff-title">
    <header><h2 id="pre-cutoff-title">立即開放：選擇截止時刻</h2><button disabled={saving} aria-label="關閉截止時間選單" onClick={() => setShowCutoff(false)}>關閉</button></header>
    <p>確認後立即開放 {month} 預排班。請選擇台灣時間：</p>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <label>小時<select aria-label="截止小時" autoFocus disabled={saving} value={hour} onChange={event => setHour(event.target.value)}><option value="">請選擇小時</option>{Array.from({ length: 24 }, (_, n) => String(n).padStart(2, '0')).map(value => <option key={value} value={value}>{value} 時</option>)}</select></label>
      <label>分鐘<select aria-label="截止分鐘" disabled={saving} value={minute} onChange={event => setMinute(event.target.value)}><option value="">請選擇分鐘</option>{Array.from({ length: 60 }, (_, n) => String(n).padStart(2, '0')).map(value => <option key={value} value={value}>{value} 分</option>)}</select></label>
    </div>
    <p role="status">{deadline ? `截止：${preTime(deadline)}${preWindowInput(deadline).slice(0, 10) !== preWindowInput(reopenNow).slice(0, 10) ? '（明天）' : '（今天）'}` : '請選擇小時與分鐘'}</p>
    <p>若選擇的時刻今天已過，將於明天該時刻截止；請確認上方完整日期。</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="settings-actions"><button disabled={saving} onClick={() => setShowCutoff(false)}>取消</button><button className="admin-primary" disabled={saving || !deadline} onClick={() => deadline && void save('open', preWindowInput(deadline))}>{saving ? '開放中…' : '確認立即開放'}</button></div>
  </section></div>}
  </>;
}
