'use strict'
const { createHash } = require('node:crypto')
const hashToken = token => createHash('sha256').update(token).digest('hex')
const millis = value => value?.toMillis?.() ?? (value ? new Date(value).getTime() : 0)
function parseTaipei(value, now = Date.now()) {
  const trimmed = String(value || '').trim()
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
  const m = normalized.match(/^\d{4}[-/]\d{2}[-/]\d{2}T\d{2}:\d{2}$/)
  if (!m) throw new Error('請輸入完整日期與時間（台北時間）')
  const fixed = normalized.replace(/-/g, '/')
  const date = new Date(`${fixed}:00+08:00`)
  if (!Number.isFinite(+date)) throw new Error('預約時間格式不正確')
  if (+date <= now) throw new Error('預約時間必須是未來的有效台北時間')
  return date
}
function targetMatches(broadcast, employeeId, records) {
  const values = (broadcast.targetValues || []).map(value => String(value).toLowerCase())
  if (broadcast.targetType === 'all') return true
  if (broadcast.targetType === 'employee') return values.includes(employeeId.toLowerCase())
  if (broadcast.targetType === 'morning') return records.some(r => r.shiftType === 'morning') && (!values.length || values.some(v => ['早班', 'morning', '早'].includes(v)))
  if (broadcast.targetType === 'night') return records.some(r => r.shiftType === 'night') && (!values.length || values.some(v => ['夜班', 'night', '晚', '夜'].includes(v)))
  if (broadcast.targetType === 'area') return records.some(r => values.includes(String(r.scheduleCode).toLowerCase()))
  return false
}
function canClaim(broadcast, now) {
  return broadcast?.push?.status === 'pending' && millis(broadcast.push.sendAt) <= now
}
module.exports = { hashToken, millis, parseTaipei, targetMatches, canClaim }
