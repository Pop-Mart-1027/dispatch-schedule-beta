'use strict'

const DAY = 86400000
function taipeiDate(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10) }
function weekStart(date = taipeiDate()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不正確')
  const d = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error('日期不存在')
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10)
}
function normalizePlate(value) {
  if (typeof value !== 'string' || value.length > 40) throw new Error('請輸入完整車號，例如 RFW-7651')
  let plate = value.normalize('NFKC').toUpperCase().replace(/[‐‑–—]/g, '-').replace(/\s/g, '')
  if (/^[A-Z]{2,3}\d{4}$/.test(plate)) plate = plate.replace(/^([A-Z]{2,3})(\d{4})$/, '$1-$2')
  if (!/^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(plate)) throw new Error('請輸入完整車號，例如 RFW-7651')
  return plate
}
function dispatchPlates(values) {
  if (!Array.isArray(values) || values.length > 500 || values.some(v => typeof v !== 'string' || v.length > 200)) throw new Error('派工車號來源格式不正確')
  const plates = new Set(), rejected = []
  for (const value of values) {
    const raw = value.normalize('NFKC').toUpperCase().replace(/[‐‑–—]/g, '-')
    const matches = raw.match(/[A-Z0-9]{2,4}\s*-\s*[A-Z0-9]{2,4}/g)
    if (matches) { for (const match of matches) plates.add(normalizePlate(match)); continue }
    if (!raw.trim() || /^(?:—|-|無|待安排)$/.test(value.trim())) continue
    try { plates.add(normalizePlate(raw)) } catch { rejected.push(value) }
  }
  if (plates.size > 500) throw new Error('車號數超過單次可管理上限')
  return { plates: [...plates].sort(), rejected }
}
function odometer(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 9999999) throw new Error('里程請填 0～9,999,999 的整數公里數')
  return value
}
function activeInWeek(vehicle, week) {
  return (vehicle.periods || []).some(period => period.from <= week && (!period.to || week < period.to))
}
module.exports = { taipeiDate, weekStart, normalizePlate, dispatchPlates, odometer, activeInWeek }
