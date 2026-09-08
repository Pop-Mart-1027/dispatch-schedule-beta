export type Checkpoint = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; active: boolean }
export type GeoPosition = { latitude: number; longitude: number; accuracy?: number }
export type GeofenceEvaluation = { canPunch: boolean; nearest: { checkpoint: Checkpoint; distanceMeters: number } | null }

export type PunchType = '上班' | '下班'
export type AttendanceStatus = 'success' | 'abnormal'

export type AttendanceLocation = Checkpoint & {
  areaCode: string
  areaName: string
  locationName: string
  note: string
  sortOrder: number
  createdAt?: unknown
  updatedAt?: unknown
}

export type AttendanceRecord = {
  id?: string
  employeeId: string
  employeeName: string
  date: string
  punchType: PunchType
  timestamp: string
  scheduleCode: string
  dispatchAreaCode: string
  locationId: string
  locationName: string
  latitude: number
  longitude: number
  accuracy: number
  distanceMeters: number
  withinGeofence: boolean
  status: AttendanceStatus
  abnormalReason: string
  createdAt?: unknown
}

export const ATTENDANCE_LOCATIONS_COLLECTION = 'attendanceLocations'
export const ATTENDANCE_RECORDS_COLLECTION = 'attendanceRecords'
export const DUPLICATE_PUNCH_WINDOW_MS = 5 * 60 * 1000

export function locationsForArea(locations: AttendanceLocation[], areaCode: string) {
  return locations.filter(location => location.active && location.areaCode === areaCode).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function canSubmitPunch(records: AttendanceRecord[], punchType: PunchType, now = Date.now()) {
  return !records.some(record => record.punchType === punchType && now - new Date(record.timestamp).getTime() < DUPLICATE_PUNCH_WINDOW_MS)
}

export function hasTodayPunch(records: AttendanceRecord[], punchType: PunchType, date: string) {
  return records.some(record => record.date === date && record.punchType === punchType && record.status === 'success')
}

export function getPunchBlockReason(records: AttendanceRecord[], punchType: PunchType, date: string) {
  if (hasTodayPunch(records, punchType, date)) return `今日已完成${punchType}打卡`
  if (punchType === '下班' && !hasTodayPunch(records, '上班', date)) return '尚未完成上班打卡'
  return ''
}

export function buildAttendanceRecord(input: {
  employeeId: string; employeeName: string; punchType: PunchType; scheduleCode: string; dispatchAreaCode: string; position: GeoPosition; evaluation: GeofenceEvaluation; timestamp?: string
}) : AttendanceRecord {
  const nearest = input.evaluation.nearest
  const withinGeofence = input.evaluation.canPunch && Boolean(nearest)
  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    date: (input.timestamp ?? new Date().toISOString()).slice(0, 10),
    punchType: input.punchType,
    timestamp: input.timestamp ?? new Date().toISOString(),
    scheduleCode: input.scheduleCode,
    dispatchAreaCode: input.dispatchAreaCode,
    locationId: nearest?.checkpoint.id ?? '',
    locationName: nearest?.checkpoint.name ?? '',
    latitude: input.position.latitude,
    longitude: input.position.longitude,
    accuracy: input.position.accuracy ?? 0,
    distanceMeters: nearest?.distanceMeters ?? 0,
    withinGeofence,
    status: withinGeofence ? 'success' : 'abnormal',
    abnormalReason: withinGeofence ? '' : '目前位置不在啟用打卡點範圍內',
  }
}
