'use client'
import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import type { Broadcast } from '../lib/broadcasts'

const labels: Record<string, string> = { pending: '等待發送', sending: '發送中', sent: '已交付 FCM', partial: '部分失敗', uncertain: '結果不明，禁止重送', cancelled: '已取消' }

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
  const when = item.push?.sendAt as { toDate?: () => Date } | undefined
  return <div><small>手機推播：{labels[item.push?.status || ''] || '尚未設定'}{when?.toDate && ` · ${when.toDate().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`}</small>
    {!locked && <><button disabled={busy || !item.active} onClick={() => void send('now')}>立即推播</button><label>預約日期時間（台北）<input aria-label={`${item.title}推播預約時間`} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></label><button disabled={busy || !item.active || !date} onClick={() => void send('scheduled')}>預約推播</button>{item.push?.status === 'pending' && <button disabled={busy} onClick={() => void send('cancel')}>取消預約</button>}</>}
    {item.push && <small>FCM 接受 {item.push.accepted || 0}／失敗 {item.push.failed || 0}</small>}<button disabled={busy} onClick={() => void reload().catch(() => setError('狀態更新失敗'))}>更新推播狀態</button>{error && <p role="alert">{error}</p>}
  </div>
}
