'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import type { buildScheduleEditCatalog } from '../lib/schedule-edit-catalog';
import './schedule-cell-editor.css';

export function ScheduleCellEditor({
  employeeId,
  name,
  date,
  currentCode,
  catalog,
  onClose,
  onSave,
}: {
  employeeId: string;
  name: string;
  date: string;
  currentCode: string;
  catalog: ReturnType<typeof buildScheduleEditCatalog>;
  onClose: () => void;
  onSave: (code: string) => Promise<void>;
}) {
  const [category, setCategory] = useState('leave'),
    [area, setArea] = useState('');
  const [code, setCode] = useState(currentCode),
    [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const choose = (value: string) => {
    setCode(value);
    setConfirm(false);
    setError('');
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(code);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '班表儲存失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="schedule-cell-editor" showCloseButton={false}>
        <DialogTitle>編輯班表</DialogTitle>
        <DialogDescription>
          {employeeId} {name} · {date}
        </DialogDescription>
        <p>目前班別：{currentCode || '—'}</p>
        <fieldset
          disabled={saving}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div
            className="schedule-edit-tabs"
            role="tablist"
            aria-label="班表編輯分類"
          >
            <button
              role="tab"
              aria-selected={category === 'leave'}
              onClick={() => {
                setCategory('leave');
                setConfirm(false);
              }}
            >
              休假
            </button>
            <button
              role="tab"
              aria-selected={category === 'area'}
              onClick={() => {
                setCategory('area');
                setConfirm(false);
              }}
            >
              區域
            </button>
          </div>
          <div className="schedule-edit-options">
            {category === 'leave' ? (
              <div className="schedule-choice-grid">
                {catalog.leaves.map((value) => (
                  <button
                    aria-pressed={code === value}
                    key={value}
                    onClick={() => choose(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="schedule-choice-grid" aria-label="可選區域">
                  {catalog.areas.map((item) => (
                    <button
                      key={item.areaCode}
                      aria-pressed={area === item.areaCode}
                      onClick={() => {
                        setArea(item.areaCode);
                        setConfirm(false);
                      }}
                    >
                      {item.areaCode}
                    </button>
                  ))}
                  <button
                    aria-pressed={area === 'special'}
                    onClick={() => setArea('special')}
                  >
                    監控／其他
                  </button>
                </div>
                {area && (
                  <>
                    <h3>
                      {area === 'special'
                        ? '監控／其他既有班別'
                        : `${area} 既有正式班碼`}
                    </h3>
                    <div className="schedule-choice-grid" aria-label="正式班碼">
                      {(area === 'special'
                        ? catalog.special
                        : catalog.areas.find((item) => item.areaCode === area)
                            ?.codes || []
                      ).map((value) => (
                        <button
                          key={value}
                          aria-pressed={code === value}
                          onClick={() => choose(value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </fieldset>
        <p role="status">
          {confirm
            ? `確認將「${currentCode}」改為「${code}」？儲存後會留下修改紀錄。`
            : `選擇結果：${code || '尚未選擇'}`}
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            disabled={saving || code === currentCode}
            onClick={() => (confirm ? void save() : setConfirm(true))}
          >
            {saving ? '儲存中…' : confirm ? '確認儲存' : '儲存修改'}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
