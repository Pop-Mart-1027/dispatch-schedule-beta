import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAttendanceRecord, canSubmitPunch, hasTodayPunch, locationsForArea } from './attendance.ts'

const location = (id, areaCode = 'A1', active = true) => ({ id, name: id, locationName: id, areaCode, areaName: areaCode, latitude: 25, longitude: 121, radiusMeters: 100, active, note: '', sortOrder: 0 })
const record = (punchType, status = 'success') => ({ employeeId: 'E1', employeeName: '測試', date: '2026-09-08', punchType, timestamp: new Date().toISOString(), scheduleCode: '上班', dispatchAreaCode: 'A1', locationId: 'L1', locationName: '測試點', latitude: 25, longitude: 121, accuracy: 10, distanceMeters: 10, withinGeofence: status === 'success', status, abnormalReason: status === 'success' ? '' : 'GPS 權限被拒絕' })

test('無今日派工時可由上層顯示未派工狀態', () => assert.equal(locationsForArea([location('L1', 'A1')], 'B1').length, 0))
test('無可用打卡點時不會選出區域地點', () => assert.equal(locationsForArea([location('L1', 'A1', false)], 'A1').length, 0))
test('GPS 權限拒絕可建立異常紀錄模型', () => { const result = buildAttendanceRecord({ employeeId: 'E1', employeeName: '測試', punchType: '上班', scheduleCode: '', dispatchAreaCode: 'A1', position: { latitude: 25, longitude: 121, accuracy: 0 }, evaluation: { canPunch: false, nearest: null } }); assert.equal(result.status, 'abnormal'); assert.equal(result.withinGeofence, false) })
test('GPS 精度過差仍保留 accuracy 供 UI 警告', () => { const result = buildAttendanceRecord({ employeeId: 'E1', employeeName: '測試', punchType: '上班', scheduleCode: '', dispatchAreaCode: 'A1', position: { latitude: 25, longitude: 121, accuracy: 150 }, evaluation: { canPunch: true, nearest: { checkpoint: location('L1'), distanceMeters: 30 } } }); assert.equal(result.accuracy, 150) })
test('重複點擊在短時間內被拒絕', () => assert.equal(canSubmitPunch([record('上班')], '上班'), false))
test('上班後再上班被視為今日已完成', () => assert.equal(hasTodayPunch([record('上班')], '上班', '2026-09-08'), true))
test('下班前未上班仍可由流程層判斷沒有上班紀錄', () => assert.equal(hasTodayPunch([record('下班')], '上班', '2026-09-08'), false))
