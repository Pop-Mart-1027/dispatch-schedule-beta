'use client';
import { useEffect, useState } from 'react';
import { preCall, preError, type PrePerson } from '../lib/pre-schedule';
import { monthlyRoster, monthlySection } from '../functions/pre-schedule-roster.mjs';

type Roster = { people: PrePerson[]; revision: number };
export function PreSchedulePeople({ month, selected, initialGroup, onClose, onSaved, onOpenEmployees }: {
  month: string;
  selected: PrePerson | null;
  initialGroup: 'day' | 'night';
  onClose: () => void;
  onSaved: (group: 'day' | 'night') => void;
  onOpenEmployees?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Roster | null>(null);
  const [employeeId, setEmployeeId] = useState(selected?.employeeId || '');
  const [person, setPerson] = useState<PrePerson | null>(selected);
  const [group, setGroup] = useState<'day' | 'night'>(selected?.group || initialGroup);
  const [section, setSection] = useState(selected ? monthlySection(selected).label : '');
  const [beforeId, setBeforeId] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void preCall<Roster>('people', month).then(result => {
      if (cancelled) return;
      setSnapshot(result);
      if (selected) {
        const ordered = monthlyRoster(result.people).filter((p: PrePerson) => p.group === selected.group && monthlySection(p).key === monthlySection(selected).key);
        const index = ordered.findIndex((p: PrePerson) => p.employeeId === selected.employeeId);
        setBeforeId(ordered[index + 1]?.employeeId || '');
      }
    }).catch(e => { if (!cancelled) setError(preError(e)); });
    return () => { cancelled = true; };
  }, [month, selected]);
  const close = () => {
    if (!busy && (!dirty || window.confirm('尚有未儲存的人員設定，確定取消？'))) onClose();
  };
  const find = async () => {
    setBusy(true); setError(''); setMissing(false); setPerson(null);
    try {
      const result = await preCall<{ person: PrePerson | null }>('findPerson', month, { employeeId });
      if (!result.person) { setMissing(true); return; }
      if (snapshot?.people.some(p => p.employeeId === result.person!.employeeId)) {
        setError('此員工已在本月份名單，請使用編輯資料／移動位置。'); return;
      }
      setPerson(result.person); setGroup(result.person.group || initialGroup);
      setSection(''); setBeforeId(''); setDirty(true);
    } catch (e) { setError(preError(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!person || !snapshot || busy || !section.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await preCall<{ person: PrePerson }>('savePerson', month, {
        mode: selected ? 'edit' : 'add', employeeId: person.employeeId,
        group, section, beforeId, rosterRevision: snapshot.revision,
      });
      onSaved(result.person.group);
    } catch (e) { setError(preError(e)); }
    finally { setBusy(false); }
  };
  const targetKey = monthlySection({ employeeId: '', group, rosterSection: section }).key;
  const candidates = monthlyRoster(snapshot?.people || []).filter((p: PrePerson) =>
    p.employeeId !== person?.employeeId && p.group === group && monthlySection(p).key === targetKey);
  const sections = [...new Set((snapshot?.people || []).filter(p => p.group === group).map(p => monthlySection(p).label))];
  return <div className="admin-modal-backdrop pre-edit-backdrop">
    <section className="admin-modal pre-edit-modal" role="dialog" aria-modal="true" aria-label={selected ? '編輯資料／移動位置' : '加入人員'}>
      <header><h3>{selected ? '編輯資料／移動位置' : '加入人員'} · {month}</h3>
        <button type="button" className="pre-edit-close" aria-label="關閉人員設定" disabled={busy} onClick={close}>X</button></header>
      <div className="pre-edit-body">
        <p>僅調整此月份預排；姓名、員編、職稱沿用員工資料，不修改員工主檔。</p>
        {!snapshot && !error && <p role="status">載入當月名單中…</p>}
        {!selected && <div className="pre-person-lookup">
          <label>員工編號<input aria-label="加入員工編號" value={employeeId} disabled={busy} onChange={e => {
            setEmployeeId(e.target.value.toUpperCase()); setPerson(null); setMissing(false); setError('');
          }} onKeyDown={e => { if (e.key === 'Enter' && snapshot && employeeId.trim() && !busy) { e.preventDefault(); void find(); } }} /></label>
          <button type="button" disabled={busy || !snapshot || !employeeId.trim()} onClick={() => void find()}>查詢員工</button>
        </div>}
        {missing && <div role="status" className="admin-alert">
          <p>查無資料，請先新增員工編號。</p>
          {onOpenEmployees && <button type="button" className="pre-person-navigation" onClick={() => {
            if (!dirty || window.confirm('尚有未儲存的人員設定，確定前往員工管理？')) onOpenEmployees();
          }}>前往員工管理</button>}
        </div>}
        {error && <div role="alert" className="admin-alert">{error}</div>}
        {person && <>
          <p className="pre-person-identity"><strong>{person.employeeId} {person.name}</strong> · {person.title}</p>
          <label>當月班別<select aria-label="人員當月班別" value={group} disabled={busy} onChange={e => {
            setGroup(e.target.value as 'day' | 'night'); setSection(''); setBeforeId(''); setDirty(true);
          }}><option value="day">日班</option><option value="night">大小夜班</option></select></label>
          <label>當月區域／編組<input aria-label="人員當月區域" list="pre-person-sections" value={section} maxLength={80} disabled={busy} placeholder="例如 O1區" onChange={e => {
            setSection(e.target.value); setBeforeId(''); setDirty(true);
          }} /></label>
          <datalist id="pre-person-sections">{sections.map(label => <option value={label} key={label} />)}</datalist>
          <label>移動位置<select aria-label="人員移動位置" value={beforeId} disabled={busy} onChange={e => { setBeforeId(e.target.value); setDirty(true); }}>
            <option value="">此區域最後一位</option>
            {candidates.map((p: PrePerson) => <option key={p.employeeId} value={p.employeeId}>排在 {p.name} {p.employeeId} 前面</option>)}
          </select></label>
          <p className="pre-edit-code-help">不刪除原預排內容；切換班別後，既有班碼請人工核對。發布中的月份不能變更。</p>
        </>}
      </div>
      <footer className="pre-edit-actions">
        <button type="button" className="pre-edit-save" disabled={busy || !snapshot || !person || !section.trim()} onClick={() => void save()}>{busy ? '處理中…' : selected ? '儲存人員設定' : '確認加入'}</button>
        <button type="button" className="pre-edit-cancel" disabled={busy} onClick={close}>取消</button>
      </footer>
    </section>
  </div>;
}
