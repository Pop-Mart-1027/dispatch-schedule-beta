export function parseBroadcastDateTime(value, now = new Date()) {
  if (!value.trim()) return null
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const [, month, day, hour, minute] = match
  const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const nowPart = (type) => nowParts.find(item => item.type === type)?.value
  const year = Number(nowPart('year'))
  const currentMonth = Number(nowPart('month'))
  const candidate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+08:00`)
  if (Number.isNaN(candidate.getTime()) || Number(month) < 1 || Number(month) > 12) return null
  const candidateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(candidate)
  const candidatePart = (type) => candidateParts.find(item => item.type === type)?.value
  if (candidatePart('month') !== month.padStart(2, '0') || candidatePart('day') !== day.padStart(2, '0') || candidatePart('hour') !== hour.padStart(2, '0') || candidatePart('minute') !== minute.padStart(2, '0')) return null
  if (Number(month) < currentMonth && candidate.getTime() < now.getTime()) candidate.setUTCFullYear(year + 1)
  return candidate
}

export function broadcastIsActive(startAt, endAt, now) {
  return (!startAt || startAt.getTime() <= now.getTime()) && (!endAt || endAt.getTime() >= now.getTime())
}
