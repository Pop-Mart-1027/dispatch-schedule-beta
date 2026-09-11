import { httpsCallable } from 'firebase/functions'
import { auth, firebaseApp, functions } from './firebase'
const tokenKey = 'smilebike.push.token'
const deviceKey = 'smilebike.push.device'
export type WebPushConfig = { vapidKey: string; canRegisterPush?: boolean }
export function pushSupportMessage() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios && !window.matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone) return 'iPhone 請先用 Safari「加入主畫面」，再從主畫面開啟並啟用通知（iOS 16.4 以上）。'
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return '此瀏覽器不支援手機推播，請使用支援 Web Push 的瀏覽器。'
  return ''
}
let registrationTask: Promise<void> | undefined
export function registerPush() { return registrationTask ??= registerCurrentDevice().finally(() => { registrationTask = undefined }) }
async function registerCurrentDevice() {
  const user = auth.currentUser
  if (!user) throw new Error('請先登入。')
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
  if (!(await isSupported())) throw new Error('此瀏覽器不支援 Firebase 推播。')
  const config = await httpsCallable<undefined, WebPushConfig>(functions, 'getWebPushConfig')()
  if (config.data.canRegisterPush === false) throw new Error('目前未開放測試員工開啟通知。')
  if (!config.data.vapidKey) throw new Error('通知服務尚未設定完成，請聯絡管理員。')
  const base = new URL(import.meta.env.BASE_URL, window.location.origin)
  const registration = await navigator.serviceWorker.register(new URL('firebase-messaging-sw.js', base), { scope: base.pathname })
  await navigator.serviceWorker.ready
  const token = await getToken(getMessaging(firebaseApp), { vapidKey: config.data.vapidKey, serviceWorkerRegistration: registration })
  if (!token) throw new Error('未取得通知 token，請重試。')
  let deviceId = localStorage.getItem(deviceKey)
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(deviceKey, deviceId) }
  const platform = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop'
  if (auth.currentUser !== user) throw new Error('登入狀態已變更，請重試。')
  await httpsCallable(functions, 'registerWebPushToken')({ token, deviceId, platform })
  localStorage.setItem(tokenKey, token)
}
export function hasPushRegistration() { return Boolean(localStorage.getItem(tokenKey)) }
export async function disablePush() { await registrationTask?.catch(() => {}); const token = localStorage.getItem(tokenKey); if (token) await httpsCallable(functions, 'unregisterWebPushToken')({ token }); const { getMessaging, deleteToken, isSupported } = await import('firebase/messaging'); if (await isSupported()) await deleteToken(getMessaging(firebaseApp)); localStorage.removeItem(tokenKey) }
export async function unregisterPushBeforeLogout() { await registrationTask?.catch(() => {}); if (localStorage.getItem(tokenKey)) await disablePush() }
