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

export function PushNotifications({ employeeId }: { employeeId: string }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [checking, setChecking] = useState(true)

  const evaluatePushState = () => {
    const support = pushSupportMessage()
    if (support) {
      setMessage(support)
      setEnabled(false)
      return
    }

    const permission = Notification.permission
    const hasRegistration = hasPushRegistration()

    if (permission !== 'granted') {
      setEnabled(false)
      setMessage(getPermissionHint(permission))
      return
    }

    if (!hasRegistration) {
      setEnabled(false)
      setMessage('尚未開啟通知，請按下方「開啟通知」。')
      return
    }

    setEnabled(true)
    setMessage('此裝置已開啟通知。')
  }

  useEffect(() => {
    let alive = true
    let permissionStatus: PermissionStatus | null = null

    const load = async () => {
      const support = pushSupportMessage()
      setMessage(support)
      setChecking(true)

      try {
        const result = await httpsCallable<undefined, WebPushConfig>(functions, 'getWebPushConfig')()
        if (!alive) return

        const canRegister = result.data.canRegisterPush ?? true
        setAllowed(canRegister)

        if (!canRegister) {
          setEnabled(false)
          setMessage('目前未開放測試員工開啟通知。')
          return
        }

        evaluatePushState()
      } catch (error) {
        if (!alive) return
        setMessage(error instanceof Error ? error.message : '取得推播設定失敗')
      } finally {
        if (!alive) return
        setChecking(false)
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

    if (!allowed) {
      setMessage('目前未開放測試員工開啟通知。')
      return
    }

    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage(getPermissionHint(permission) || '尚未授權通知，請先授權。')
        setEnabled(false)
        return
      }

      await registerPush()
      setEnabled(true)
      setMessage('此裝置已開啟通知，關閉 App 後也可接收廣播。')
    } catch (error) {
      setEnabled(false)
      setMessage(error instanceof Error ? error.message : '通知註冊失敗，請重試。')
    } finally {
      setBusy(false)
      evaluatePushState()
    }
  }

  if (enabled) return null

  return allowed
    ? <div>
      <button className="primary" disabled={busy} onClick={() => void enable()}>{busy ? '通知設定中…' : '開啟通知'}</button>
      <p role="status">{message || (checking ? '檢查推播權限中…' : '')}</p>
    </div>
    : <p role="status">{checking ? '檢查推播權限中…' : message || '目前僅測試白名單可開啟手機推播。'}</p>
}
