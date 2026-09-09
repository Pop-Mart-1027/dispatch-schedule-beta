import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

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
}

export type DispatchBlockEditable = Pick<DispatchBlock, 'vehicleNo' | 'drivers' | 'stations' | 'assistants' | 'workFocus' | 'balanceArea' | 'note'>

export async function listDispatchBlocks(date: string) {
  const snapshot = await getDocs(query(collection(db, 'dispatchBlocks'), where('date', '==', date)))
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as DispatchBlock))
    .filter(item => item.status !== 'deleted')
    .sort((left, right) => left.shiftType.localeCompare(right.shiftType) || left.sourceRow - right.sourceRow || left.blockId.localeCompare(right.blockId))
}

export async function listDispatchBlockTemplate(date: string) {
  const snapshot = await getDocs(query(collection(db, 'dispatchBlocks'), orderBy('date', 'desc'), limit(500)))
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
      areaName: block.areaName,
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
