'use client';
import { useState } from 'react';
import { Switch } from '../components/ui/switch';
import {
  useSystemFeatures,
  saveSystemFeature,
  type SystemFeatures,
} from '../lib/system-features';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import './schedule-cell-editor.css';
import './system-feature-settings.css';
const labels: Record<keyof SystemFeatures, string> = {
  attendanceEnabled: '打卡備案',
  broadcastsEnabled: '廣播功能',
  dispatchEnabled: '正式派工',
};
export function SystemFeatureSettings({ employeeId }: { employeeId: string }) {
  const { features, loading, error } = useSystemFeatures();
  const [saving, setSaving] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<boolean | null>(null);
  const save = async (key: keyof SystemFeatures, value: boolean) => {
    setSaving(true);
    setMessage('');
    try {
      await saveSystemFeature(key, value, employeeId);
      setMessage(`${labels[key]}已儲存`);
      setPending(null);
    } catch (error) {
      console.error('[systemSettings] save failed', error);
      setMessage('設定儲存失敗，請確認管理員權限或網路。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="settings-grid">
      <section className="admin-panel settings-panel">
        <header>
          <h2>系統設定</h2>
        </header>
        {(Object.keys(labels) as (keyof SystemFeatures)[]).map((key) => (
          <div className="setting-row" key={key}>
            <b>{labels[key]}</b>
            <div className="feature-toggle">
              <span className={features[key] ? 'on' : 'off'}>
                {features[key] ? '開' : '關'}
              </span>
              <Switch
                className="feature-switch"
                aria-label={labels[key]}
                checked={features[key]}
                disabled={loading || saving || !!error}
                onCheckedChange={(value) =>
                  key === 'dispatchEnabled'
                    ? setPending(value)
                    : void save(key, value)
                }
              />
            </div>
          </div>
        ))}
        <p className="settings-save-status" role="status">
          {loading
            ? '載入設定中…'
            : error || message || '設定會即時套用至一般員工前台。'}
        </p>
        <Dialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open && !saving) setPending(null);
          }}
        >
          <DialogContent
            className="schedule-cell-editor"
            showCloseButton={false}
          >
            <DialogTitle>確認{pending ? '開啟' : '關閉'}正式派工</DialogTitle>
            <DialogDescription>
              此設定會影響一般員工前台的派工入口與畫面，不修改派工資料。
            </DialogDescription>
            {message.includes('失敗') && <p role="alert">{message}</p>}
            <footer>
              <button disabled={saving} onClick={() => setPending(null)}>
                取消
              </button>
              <button
                disabled={saving}
                onClick={() =>
                  pending !== null && void save('dispatchEnabled', pending)
                }
              >
                確認變更
              </button>
            </footer>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
