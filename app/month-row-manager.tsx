'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import { manageMonthRow, type MonthLayout } from '../lib/month-schedule-layout';
import {
  scheduleSections,
  preScheduleSource,
} from '../functions/pre-schedule-order.mjs';
import { scheduleSectionIdentity } from '../functions/schedule-section-key.mjs';
import './work-focus.css';
export function MonthRowManager({
  month,
  layout,
  people,
  present,
  selected,
  onClose,
  onSaved,
}: {
  month: string;
  layout: MonthLayout | null;
  people: { employeeId: string; name: string }[];
  present: string[];
  selected?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [action, setAction] = useState(selected ? '' : 'add'),
    [personId, setPersonId] = useState(selected || ''),
    [group, setGroup] = useState(layout?.rows.find(r=>r.employeeId===selected)?.group || preScheduleSource(selected)?.group || 'day'),
    [sectionKey, setSectionKey] = useState(''),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const options = scheduleSections(people, group);
  // Include month-specific sections without replacing original source choices.
  for (const row of layout?.rows || [])
    if (row.group === group) {
      const identity = scheduleSectionIdentity(
        row.section,
        row.areaCode || '',
        group,
      );
      if (!options.some((s) => s.key === identity.key))
        options.push({ ...identity, people: [] });
    }
  const person = people.find((p) => p.employeeId === personId),
    option = options.find((s) => s.key === sectionKey);
  const save = async () => {
    if (!person) return setError('請選擇正式員工');
    if (['move', 'add'].includes(action) && !option)
      return setError('請選擇組別與區域');
    if (action === 'remove' && !confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await manageMonthRow({
        monthKey: month,
        revision: layout?.revision || 0,
        action,
        employeeId: personId,
        confirmed: confirm,
        ...(['move', 'add'].includes(action)
          ? {
              group,
              section:
                preScheduleSource(option.people[0]?.employeeId)?.section ||
                option.label,
              areaCode: option.areaCode,
            }
          : {}),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="month-row-dialog" showCloseButton={!busy}>
        <DialogTitle>本月班表人員管理</DialogTitle>
        <DialogDescription>
          {month} ·{' '}
          {selected
            ? people.find((p) => p.employeeId === selected)?.name
            : '新增人員'}
          ；移區會同步轉換本月原區域的工作班碼，並取消這些日期該人的舊人工派工。保留班型、休假與其他區域班碼；上／下移只調整順序。
        </DialogDescription>
        <div className="month-row-actions">
          {(selected
            ? [
                ['move', '移動到區域'],
                ['up', '上移'],
                ['down', '下移'],
                ['add', '新增人員'],
                ['remove', '移出本月班表'],
              ]
            : [['add', '新增人員']]
          ).map(([value, label]) => (
            <button
              key={value}
              disabled={busy}
              aria-pressed={action === value}
              onClick={() => {
                setAction(value);
                setPersonId(value === 'add' ? '' : selected || '');
                setConfirm(false);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {action === 'add' && (
          <>
            <label>
              搜尋既有員工
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="員編／姓名"
              />
            </label>
            <div className="month-person-list">
              {people
                .filter(
                  (p) =>
                    !present.includes(p.employeeId) &&
                    `${p.employeeId} ${p.name}`.includes(search),
                )
                .map((p) => (
                  <button
                    key={p.employeeId}
                    aria-pressed={personId === p.employeeId}
                    onClick={() => setPersonId(p.employeeId)}
                  >
                    {p.employeeId} {p.name}
                  </button>
                ))}
            </div>
          </>
        )}
        {['move', 'add'].includes(action) && (
          <>
            <label>
              組別
              <select
                aria-label="組別"
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setSectionKey('');
                }}
              >
                <option value="day">日班</option>
                <option value="night">大小夜班</option>
              </select>
            </label>
            <label>
              區域
              <select
                aria-label="區域"
                value={sectionKey}
                onChange={(e) => setSectionKey(e.target.value)}
              >
                <option value="">選擇區域</option>
                {options.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {confirm && (
          <p role="alert">
            確定要將 {person?.name} 移出 {Number(month.slice(0, 4))}年
            {Number(month.slice(5))}
            月班表嗎？本月不再納入正式班表與派工；保留歷史紀錄，不刪除員工帳號、不影響其他月份。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="month-row-actions">
          <button disabled={busy} onClick={onClose}>
            取消
          </button>
          <button disabled={busy || !action} onClick={() => void save()}>
            {busy
              ? '儲存中…'
              : confirm
                ? '確認移出'
                : action === 'remove'
                  ? '移出本月班表'
                  : '儲存'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
