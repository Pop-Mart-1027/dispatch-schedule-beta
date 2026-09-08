import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateGeofence, haversineDistanceMeters } from './geofence.js'

const here = { latitude: 25, longitude: 121 }
const point = (id, latitude, longitude, radiusMeters = 100, active = true) => ({ id, name: id, latitude, longitude, radiusMeters, active })

test('範圍內可打卡', () => assert.equal(evaluateGeofence(here, [point('near', 25, 121.0005, 100)]).canPunch, true))
test('範圍外不可打卡', () => assert.equal(evaluateGeofence(here, [point('far', 25, 121.01, 100)]).canPunch, false))
test('五個打卡點任一符合即可', () => assert.equal(evaluateGeofence(here, [point('1', 25, 121.01), point('2', 25, 121.02), point('3', 25, 121.03), point('4', 25, 121.04), point('5', 25, 121.0005)]).canPunch, true))
test('停用點不參與判定', () => assert.equal(evaluateGeofence(here, [point('disabled', 25, 121.0001, 100, false)]).canPunch, false))
test('不同半徑判定正確', () => { const result = evaluateGeofence(here, [point('small', 25, 121.001, 50), point('large', 25, 121.001, 150)]); assert.equal(result.canPunch, true); assert.equal(result.nearest.checkpoint.id, 'small') })
test('最近打卡點距離正確', () => { const result = evaluateGeofence(here, [point('near', 25, 121.001), point('far', 25, 121.01)]); assert.ok(Math.abs(result.nearest.distanceMeters - haversineDistanceMeters(here, result.nearest.checkpoint)) < 0.001); assert.equal(result.nearest.checkpoint.id, 'near') })
