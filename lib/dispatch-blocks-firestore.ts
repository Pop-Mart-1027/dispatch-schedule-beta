import { addDoc, collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
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

export async function updateDispatchBlock(block: DispatchBlock, values: DispatchBlockEditable, modifiedBy: string) {
  await setDoc(doc(db, 'dispatchBlocks', block.id), {
    ...values,
    modifiedBy,
    modifiedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
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
