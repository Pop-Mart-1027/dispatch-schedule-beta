'use client'
import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import type { Broadcast } from '../lib/broadcasts'
export function BroadcastPushControls({ item, reload }: { item: Broadcast; reload: () => Promise<void> }) {
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = item.push && !['pending', 'cancelled'].includes(item.push.status)
  const send = async (mode: 'now' | 'scheduled' | 'cancel') => {
    setBusy(true); setError('')
    try { await httpsCallable(functions, 'scheduleBroadcastPush')({ broadcastId: item.id, mode, scheduledAt: date }); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : '推播設定失敗') }
    finally { setBusy(false) }
  }
  return <div>
    {!locked && <><button disabled={busy || !item.active} onClick={() => void send('now')}>立即推播</button><label>預約日期時間（台北）<input aria-label={`${item.title}推播預約時間`} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></label><button disabled={busy || !item.active || !date} onClick={() => void send('scheduled')}>預約推播</button>{item.push?.status === 'pending' && <button disabled={busy} onClick={() => void send('cancel')}>取消預約</button>}</>}
    <button disabled={busy} onClick={() => void reload().catch(() => setError('狀態更新失敗'))}>更新推播狀態</button>{error && <p role="alert">{error}</p>}</div>
}
