'use client'
import { useEffect, useState } from 'react'
import { hasPushRegistration, pushSupportMessage, registerPush, type WebPushConfig } from '../lib/web-push'
import { functions } from '../lib/firebase'
import { httpsCallable } from 'firebase/functions'

const getPermissionHint = (permission: NotificationPermission) => {
  if (permission === 'denied') return '尚未允許通知；若已封鎖，請到瀏覽器或手機設定開啟。'
  if (permission === 'default') return '尚未授權通知，請先授權。'
  return ''
}

type PushUiState = 'unknown' | 'enabled' | 'disabled'

export function PushNotifications({ employeeId }: { employeeId: string }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [canRegister, setCanRegister] = useState(false)
  const [state, setState] = useState<PushUiState>('unknown')

  const evaluatePushState = () => {
    const support = pushSupportMessage()
    if (support) {
      setMessage(support)
      setState('disabled')
      return
    }

    const permission = Notification.permission
    const hasRegistration = hasPushRegistration()

    if (permission !== 'granted') {
      setState('disabled')
      setMessage(getPermissionHint(permission) || '尚未授權通知，請先授權。')
      return
    }

    if (!hasRegistration) {
      setState('disabled')
      setMessage('尚未開啟通知，請按下方「開啟通知」。')
      return
    }

    setState('enabled')
    setMessage('')
  }

  useEffect(() => {
    let alive = true
    let permissionStatus: PermissionStatus | null = null

    const load = async () => {
      setMessage('')
      setState('unknown')

      try {
        const result = await httpsCallable<undefined, WebPushConfig>(functions, 'getWebPushConfig')()
        if (!alive) return

        const nextCanRegister = result.data.canRegisterPush ?? true
        setCanRegister(nextCanRegister)

        if (!nextCanRegister) {
          setState('disabled')
          setMessage('目前未開放測試員工開啟通知。')
          return
        }

        evaluatePushState()
      } catch (error) {
        if (!alive) return
        setCanRegister(false)
        setState('disabled')
        setMessage(error instanceof Error ? error.message : '取得推播設定失敗')
      }
    }

    void load()

    const watchPermission = async () => {
      if (!('permissions' in navigator)) return
      try {
        const status = await navigator.permissions.query({
          name: 'notifications' as PermissionDescriptor['name'],
        })
        permissionStatus = status
        status.onchange = () => {
          if (!alive) return
          evaluatePushState()
        }
      } catch {
        // 部分瀏覽器不支援 permissions API。
      }
    }
    void watchPermission()

    return () => {
      alive = false
      if (permissionStatus) {
        permissionStatus.onchange = null
      }
    }
  }, [employeeId])

  const enable = async () => {
    const support = pushSupportMessage()
    if (support) {
      setMessage(support)
      return
    }

    if (!canRegister) {
      setMessage('目前未開放測試員工開啟通知。')
      return
    }

    setBusy(true)
    setMessage('通知設定中…')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage(getPermissionHint(permission) || '尚未授權通知，請先授權。')
        setState('disabled')
        return
      }

      await registerPush()
      evaluatePushState()
    } catch (error) {
      setState('disabled')
      setMessage(error instanceof Error ? error.message : '通知註冊失敗，請重試。')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'unknown' || state === 'enabled') {
    return null
  }

  return canRegister
    ? (
      <div>
        <button className="primary" disabled={busy} onClick={() => void enable()}>{busy ? '通知設定中…' : '開啟通知'}</button>
        {message && <p role="status">{message}</p>}
      </div>
    )
    : <p role="status">{message || '目前僅測試白名單可開啟手機推播。'}</p>
}
