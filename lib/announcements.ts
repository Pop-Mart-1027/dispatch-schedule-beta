import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'

export type AnnouncementImage = {
  imageUrl: string
  originalName: string
  mediaType: string
  originalSize: number
  storedBytes: number
  width: number
  height: number
  updatedBy: string
  updatedAt?: unknown
}

const announcementRef = doc(db, 'announcements', 'current')
const maximumInputBytes = 12 * 1024 * 1024
const maximumStoredCharacters = 750_000

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取這張圖片'))
    }
    image.src = url
  })
}

async function resizeForFirestore(file: File) {
  const image = await loadImage(file)
  let scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight))
  let quality = 0.9
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('瀏覽器無法處理圖片縮放')
    context.drawImage(image, 0, 0, width, height)
    const imageUrl = canvas.toDataURL('image/webp', quality)
    if (imageUrl.length <= maximumStoredCharacters) {
      const mediaType = imageUrl.slice(5, imageUrl.indexOf(';')) || 'image/webp'
      return { imageUrl, mediaType, width, height, storedBytes: imageUrl.length }
    }
    if (quality > 0.55) quality -= 0.1
    else scale *= 0.82
  }
  throw new Error('圖片內容過大，系統自動縮放後仍無法儲存')
}

export async function getCurrentAnnouncement() {
  const snapshot = await getDoc(announcementRef)
  return snapshot.exists() ? snapshot.data() as AnnouncementImage : null
}

export async function uploadCurrentAnnouncement(file: File, employeeId: string) {
  if (!file.type.startsWith('image/')) throw new Error('只允許上傳圖片檔')
  if (file.size > maximumInputBytes) throw new Error('公告圖片不可超過 12 MB')
  const resized = await resizeForFirestore(file)
  const announcement = {
    ...resized,
    originalName: file.name,
    originalSize: file.size,
    updatedBy: employeeId,
  }
  await setDoc(announcementRef, { ...announcement, updatedAt: serverTimestamp() })
  return announcement as AnnouncementImage
}

export async function removeCurrentAnnouncement(_current: AnnouncementImage | null, employeeId: string) {
  await setDoc(announcementRef, {
    imageUrl: '',
    originalName: '',
    mediaType: '',
    originalSize: 0,
    storedBytes: 0,
    width: 0,
    height: 0,
    updatedBy: employeeId,
    updatedAt: serverTimestamp(),
  })
}
