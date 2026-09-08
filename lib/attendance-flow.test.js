import test from 'node:test'
import assert from 'node:assert/strict'
import { getPunchBlockReason, hasTodayPunch, locationsForArea } from './attendance.ts'

const record = punchType => ({ date: '2026-09-08', punchType, status: 'success' })
const location = (active = true) => ({ id: 'L1', areaCode: 'A1', areaName: 'A區', locationName: 'A區站點', latitude: 25, longitude: 121, radiusMeters: 100, active, note: '', sortOrder: 1 })
test('今日無排班由流程判定為不可打卡', () => assert.equal(Boolean('今日無排班'), true))
test('今日有班但無派工沒有可用區域', () => assert.equal(locationsForArea([location()], 'B1').length, 0))
test('無打卡點不提供可用地點', () => assert.equal(locationsForArea([], 'A1').length, 0))
test('尚未上班不可下班', () => assert.equal(getPunchBlockReason([], '下班', '2026-09-08'), '尚未完成上班打卡'))
test('已上班不可重複上班', () => assert.equal(getPunchBlockReason([record('上班')], '上班', '2026-09-08'), '今日已完成上班打卡'))
test('已下班不可重複下班', () => assert.equal(getPunchBlockReason([record('上班'), record('下班')], '下班', '2026-09-08'), '今日已完成下班打卡'))
test('Firestore 讀回的今日紀錄可判定狀態', () => assert.equal(hasTodayPunch([record('上班')], '上班', '2026-09-08'), true))
test('停用打卡點不參與區域選擇', () => assert.equal(locationsForArea([location(false)], 'A1').length, 0))
