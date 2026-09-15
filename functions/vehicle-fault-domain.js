'use strict'

// Vehicle reporting only. These windows do not change dispatch business dates.
const MONITOR_WINDOWS = { early: [7 * 60, 17 * 60], late: [12 * 60, 21 * 60], night: [21 * 60, 31 * 60] }
const FAULT_TYPES = ['動力／引擎', '煞車／輪胎', '燈號／電系', '車體／設備', '其他故障']
const PRIORITIES = ['normal', 'priority', 'urgent']
// Base64 must also fit within a non-streaming callable response.
const MAX_FILE_BYTES = 6 * 1024 * 1024

function taipeiDate(now) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10) }
function monitorOnDuty(record, employee, now) {
  if (!employee || employee.active !== true || employee.mustChangePassword !== false || !['duty', 'admin'].includes(employee.role)) return false
  const code = String(record.scheduleCode || record.scheduleLabel || '').trim()
  if (!code || (!code.includes('監') && !String(employee.title || '').includes('監控'))) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) return false
  const midnight = Date.parse(`${record.date}T00:00:00+08:00`)
  return code.split(/[／/、\n]+/).some(segment => {
    if (/假|休|例|病|事|慰/.test(segment)) return false
    const shifts = []
    if (segment.includes('早')) shifts.push('early')
    if (segment.includes('晚') || segment.includes('小夜')) shifts.push('late')
    if (segment.includes('夜')) shifts.push('night')
    return shifts.some(shift => {
      const [start, end] = MONITOR_WINDOWS[shift]
      return now >= midnight + start * 60000 && now < midnight + end * 60000
    })
  })
}

function validMedia(bytes, mime) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) return false
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (['video/mp4', 'video/quicktime'].includes(mime)) return bytes.toString('ascii', 4, 8) === 'ftyp'
  if (mime === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
  return false
}

module.exports = { MONITOR_WINDOWS, FAULT_TYPES, PRIORITIES, MAX_FILE_BYTES, taipeiDate, monitorOnDuty, validMedia }
