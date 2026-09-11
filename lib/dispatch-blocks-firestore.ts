import { configuredDispatchBlocks, readDispatchConfigurationBase } from './dispatch-configuration'
import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { getMonthLayout } from './month-schedule-layout'
import { eligibleMonthBlocks } from '../functions/month-schedule-policy.mjs'

export type DispatchBlockPerson = {
  employeeId: string
  employeeName: string
  sourceText?: string
  sourceRow?: number
}

export type DispatchBlock = {
  id: string
  date: string
  shiftType: 'day' | 'night'
  blockId: string
  areaCode: string | null
  areaName: string
  variantCode: string
  vehicleNo: string
  vehicleType: string
  drivers: DispatchBlockPerson[]
  stations: DispatchBlockPerson[]
  assistants: DispatchBlockPerson[]
  workFocus: string
  balanceArea: string
  note: string
  sourceSheet: string
  sourceRow: number
  sourceUpdatedAt?: unknown
  status: string
  createdAt?: unknown
  updatedAt?: unknown
  modifiedBy: string
  modifiedAt?: unknown
  /** Derived monthly reset marker; not part of the Firestore block schema. */
  monthAssignmentResetIds?: string[]
}

export type DispatchBlockEditable = Pick<DispatchBlock, 'areaName' | 'vehicleNo' | 'drivers' | 'stations' | 'assistants' | 'workFocus' | 'balanceArea' | 'note'>

export async function listDispatchBlocks(date: string, database = db) {
  const [snapshot, layout] = await Promise.all([getDocs(query(collection(database, 'dispatchBlocks'), where('date', '==', date))), getMonthLayout(date.slice(0,7), database)])
  return (eligibleMonthBlocks(await configuredDispatchBlocks(date, snapshot.docs.map(item => ({ id: item.id, ...item.data() } as DispatchBlock)), database), layout) as DispatchBlock[])
    .filter(item => item.status !== 'deleted')
    .sort((left, right) => left.shiftType.localeCompare(right.shiftType) || left.sourceRow - right.sourceRow || left.blockId.localeCompare(right.blockId))
}

export async function listDispatchBlockTemplate(date: string, database = db) {
  const base = await readDispatchConfigurationBase(database)
  // An absent historical day stays absent; never synthesize history from a new
  // daily override or a future configuration version.
  if (base && date < base.activeFrom) return { sourceDate: '', blocks: [] as DispatchBlock[] }
  if (base) return { sourceDate: base.activeFrom, blocks: await configuredDispatchBlocks(date, [], database) }
  const snapshot = await getDocs(query(collection(database, 'dispatchBlocks'), orderBy('date', 'desc'), limit(500)))
  const byDate = new Map<string, DispatchBlock[]>()
  snapshot.docs
    .map(item => ({ id: item.id, ...item.data() } as DispatchBlock))
    .filter(item => item.status !== 'deleted' && item.date !== date)
    .forEach(item => byDate.set(item.date, [...(byDate.get(item.date) || []), item]))
  const selectedTime = new Date(`${date}T00:00:00+08:00`).getTime()
  const sourceDate = [...byDate.keys()].sort((left, right) => {
    const leftTime = new Date(`${left}T00:00:00+08:00`).getTime()
    const rightTime = new Date(`${right}T00:00:00+08:00`).getTime()
    return Math.abs(leftTime - selectedTime) - Math.abs(rightTime - selectedTime)
      || Number(rightTime <= selectedTime) - Number(leftTime <= selectedTime)
      || right.localeCompare(left)
  })[0]
  return { sourceDate: sourceDate || '', blocks: sourceDate ? byDate.get(sourceDate) || [] : [] }
}

export function buildDispatchPreviewBlocks(template: DispatchBlock[], date: string) {
  return template.map(block => {
    const suffix = block.blockId.replace(/^\d{4}-\d{2}-\d{2}_/, '')
    const blockId = `${date}_${suffix}`
    return {
      ...block,
      id: blockId,
      blockId,
      date,
      drivers: [],
      stations: [],
      assistants: [],
      sourceSheet: `班表預覽（block 結構 ${block.date}）`,
      sourceUpdatedAt: null,
      status: 'preview',
      createdAt: null,
      updatedAt: null,
      modifiedBy: '',
      modifiedAt: null,
    }
  })
}

export async function updateDispatchBlock(block: DispatchBlock, values: DispatchBlockEditable, modifiedBy: string) {
  await setDoc(doc(db, 'dispatchBlocks', block.id), {
    ...values,
    modifiedBy,
    modifiedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function saveDispatchPreviewAsFormal(
  blocks: DispatchBlock[],
  editedBlockId: string,
  editedValues: DispatchBlockEditable,
  modifiedBy: string,
) {
  const batch = writeBatch(db)
  for (const block of blocks) {
    const edited = block.id === editedBlockId
    const values: DispatchBlockEditable = edited ? editedValues : {
      areaName: block.areaName,
      vehicleNo: block.vehicleNo,
      drivers: block.drivers,
      stations: block.stations,
      assistants: block.assistants,
      workFocus: block.workFocus,
      balanceArea: block.balanceArea,
      note: block.note,
    }
    batch.set(doc(db, 'dispatchBlocks', block.id), {
      date: block.date,
      shiftType: block.shiftType,
      blockId: block.blockId,
      areaCode: block.areaCode,
      variantCode: block.variantCode,
      vehicleType: block.vehicleType,
      ...values,
      sourceSheet: block.sourceSheet,
      sourceRow: block.sourceRow,
      sourceUpdatedAt: null,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      modifiedBy: edited ? modifiedBy : '',
      modifiedAt: edited ? serverTimestamp() : null,
    })
  }
  await batch.commit()
}

export async function writeDispatchBlockAudit(block: DispatchBlock, after: DispatchBlockEditable, modifiedBy: string) {
  const before: DispatchBlockEditable = {
    areaName: block.areaName,
    vehicleNo: block.vehicleNo,
    drivers: block.drivers,
    stations: block.stations,
    assistants: block.assistants,
    workFocus: block.workFocus,
    balanceArea: block.balanceArea,
    note: block.note,
  }
  await addDoc(collection(db, 'dispatchAuditLogs'), {
    recordType: 'dispatchBlock',
    recordId: block.id,
    blockId: block.blockId,
    date: block.date,
    before,
    after,
    modifiedBy,
    createdAt: serverTimestamp(),
  })
}
