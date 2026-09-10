'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import {
  manageMonthRow,
  type MonthLayout,
  type MonthSection,
} from '../lib/month-schedule-layout';
import './month-structure.css';

export function MonthSectionManager({
  month,
  layout,
  sections,
  initialGroup,
  action,
  selected,
  onClose,
  onSaved,
}: {
  month: string;
  layout: MonthLayout | null;
  sections: MonthSection[];
  initialGroup: string;
  action: 'section-add' | 'section-delete' | 'section-rename';
  selected?: MonthSection;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [group, setGroup] = useState(selected?.group || initialGroup);
  const [key, setKey] = useState(selected?.key || '');
  const [label, setLabel] = useState(selected?.label || '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const target = sections.find((s) => s.key === key && s.group === group);
  const title =
    action === 'section-add'
      ? '新增區域'
      : action === 'section-delete'
        ? '刪除區域'
        : '編輯區域名稱';
  async function save() {
    if (action !== 'section-add' && !target) return setError('請選擇區域');
    if (action === 'section-delete' && !confirmed) {
      setConfirmed(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await manageMonthRow({
        monthKey: month,
        revision: layout?.revision || 0,
        action,
        group,
        sectionKey: key,
        label,
        confirmed,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="month-row-dialog" showCloseButton={false}>
        <button
          className="month-dialog-close"
          aria-label="關閉"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {month}；只影響目前月份。
          {action === 'section-rename'
            ? '只改顯示名稱，不改班碼與人員順序。'
            : action === 'section-add'
              ? '可填標準區域或特殊群組名稱；特殊群組換入時保留原班碼。'
              : '只有空區域可以刪除。'}
        </DialogDescription>
        {action !== 'section-rename' && (
          <label>
            組別
            <select
              aria-label="組別"
              value={group}
              disabled={busy}
              onChange={(e) => {
                setGroup(e.target.value);
                setKey('');
                setConfirmed(false);
              }}
            >
              <option value="day">日班</option>
              <option value="night">大小夜班</option>
            </select>
          </label>
        )}
        {action === 'section-delete' ? (
          <label>
            區域
            <select
              aria-label="區域"
              disabled={busy}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setConfirmed(false);
                setError('');
              }}
            >
              <option value="">選擇區域</option>
              {sections
                .filter((s) => s.group === group)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label>
            區域名稱
            <input
              aria-label="區域名稱"
              maxLength={100}
              disabled={busy}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        )}
        {confirmed && (
          <p role="alert">
            確定刪除 {target?.label}？只影響 {month}，不影響歷史月份。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="month-row-actions">
          <button disabled={busy} onClick={() => void save()}>
            {busy
              ? '儲存中…'
              : confirmed
                ? '確認刪除'
                : action === 'section-delete'
                  ? '刪除區域'
                  : '儲存'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
