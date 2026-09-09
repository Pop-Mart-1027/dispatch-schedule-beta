'use strict'

const { parseCsv, parseDay, parseNight } = require('./dispatch-block-parser')

// One explicit import replaces one complete date, with an audit for every change.
async function importGoogleDispatch({ date, actorId, db, fetch, FieldValue, HttpsError }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new HttpsError('invalid-argument', '日期格式不正確')
  }
  const [year, month, day] = date.split('-').map(Number)
  const daySheet = '雙北今日派工單看這邊'
  const nightSheet = `${month}/${day}大夜派工單`
  const readSheet = async sheet => {
    const response = await fetch(`https://docs.google.com/spreadsheets/d/1RBzq8miIdUFCTM2PZhAsDe7rNMCdfMxN6lVfV-NLhmk/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new HttpsError('failed-precondition', `無法讀取分頁：${sheet}`)
    const text = await response.text()
    if (/<!doctype|<html/i.test(text)) throw new HttpsError('failed-precondition', `分頁無法讀取，請確認分享權限：${sheet}`)
    return parseCsv(text)
  }
  const [dayRows, nightRows, employeeSnapshot] = await Promise.all([
    readSheet(daySheet), readSheet(nightSheet), db.collection('employees').where('active', '==', true).get(),
  ])
  for (const [rows, sheet] of [[dayRows, daySheet], [nightRows, nightSheet]]) {
    const header = rows.slice(0, 3).flat().join(' ')
    // A missing named sheet may return another tab: retain each source's date format.
    const datePattern = sheet === nightSheet
      ? new RegExp(`(?:^|[^\\d])0?${month}/0?${day}(?:[^\\d]|$)`)
      : new RegExp(`(?:^|[^\\d])0?${month}月0?${day}日`)
    const explicitYears = header.match(/\b20\d{2}(?=[年/.-])/g) || []
    if (!datePattern.test(header) || explicitYears.some(value => Number(value) !== year)) {
      throw new HttpsError('failed-precondition', `分頁「${sheet}」並非所選日期 ${date}，未變更任何派工`)
    }
  }
  const employees = employeeSnapshot.docs.map(item => ({ employeeId: item.id, name: item.data().name }))
  const daytime = parseDay(dayRows, date, employees)
  const nighttime = parseNight(nightRows, date, nightSheet, employees)
  if (!daytime.blocks.length || !nighttime.blocks.length) throw new HttpsError('failed-precondition', '當日早班或夜班來源沒有可辨識的派工資料，未變更任何派工')
  const blocks = [...daytime.blocks, ...nighttime.blocks]
  const conflicts = [...daytime.conflicts, ...nighttime.conflicts]
  const fields = ['areaCode', 'areaName', 'variantCode', 'vehicleNo', 'vehicleType', 'drivers', 'stations', 'assistants', 'workFocus', 'balanceArea', 'note', 'status']
  const auditData = value => value ? Object.fromEntries(fields.map(key => [key, value[key] ?? null])) : null
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(db.collection('dispatchBlocks').where('date', '==', date))
    const byId = new Map(existing.docs.map(item => [item.id, item.data()]))
    const ids = new Set(blocks.map(block => block.blockId))
    const obsolete = existing.docs.filter(item => !ids.has(item.id) && item.data().status !== 'deleted')
    if ((blocks.length + obsolete.length) * 2 + conflicts.length > 490) {
      throw new HttpsError('failed-precondition', '當日資料超過單次完整匯入上限，未變更任何派工，請洽管理員')
    }
    const writeAudit = (id, before, after) => transaction.set(db.collection('dispatchAuditLogs').doc(), {
      recordType: 'dispatchBlock', recordId: id, blockId: id, date,
      before: auditData(before), after: auditData(after), modifiedBy: actorId,
      source: 'google-manual-import', createdAt: FieldValue.serverTimestamp(),
    })
    for (const block of blocks) {
      const previous = byId.get(block.blockId)
      const payload = { ...block, sourceUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        createdAt: previous?.createdAt || FieldValue.serverTimestamp(), modifiedBy: actorId, modifiedAt: FieldValue.serverTimestamp() }
      transaction.set(db.collection('dispatchBlocks').doc(block.blockId), payload)
      writeAudit(block.blockId, previous, payload)
    }
    for (const item of obsolete) {
      transaction.update(item.ref, { status: 'deleted', modifiedBy: actorId, modifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      writeAudit(item.id, item.data(), { ...item.data(), status: 'deleted' })
    }
    for (const conflict of conflicts) transaction.set(db.collection('dispatchBlockConflicts').doc(), {
      ...conflict, date, status: 'unresolved', createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { date, dayBlocks: daytime.blocks.length, nightBlocks: nighttime.blocks.length, conflicts: conflicts.length }
}

module.exports = { importGoogleDispatch }
