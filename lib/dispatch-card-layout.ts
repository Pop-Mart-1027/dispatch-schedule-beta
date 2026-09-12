import { dispatchBlockFrontOrder } from './dispatch-area'
import { mergeShiftDispatchCards, type ShiftDispatchBlock } from './dispatch-schedule-assignment'

export type DispatchDisplayCard = ShiftDispatchBlock & { sourceBlockIds: string[]; vehicleCount: number }

// Second display stage only: retain single-vehicle dedupe, then pair vehicles.
export function pairDispatchCards(blocks: ShiftDispatchBlock[]): DispatchDisplayCard[] {
  const groups = new Map<string, ShiftDispatchBlock[]>()
  for (const block of mergeShiftDispatchCards(blocks).sort(dispatchBlockFrontOrder)) {
    const area = (block.areaCode || block.areaName || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '')
    const key = JSON.stringify([block.date, block.dispatchShift, area])
    groups.set(key, [...(groups.get(key) || []), block])
  }
  return [...groups.values()].flatMap(vehicles => {
    const cards: DispatchDisplayCard[] = []
    for (let index = 0; index < vehicles.length; index += 2) {
      const pair = vehicles.slice(index, index + 2)
      // Reuse the existing people/text merge, with a temporary common vehicle
      // key. Original vehicle rows and their source identities remain untouched.
      const merged = mergeShiftDispatchCards(pair.map(block => ({ ...block, vehicleNo: pair[0].vehicleNo })))[0]
      cards.push({ ...merged, vehicleNo: pair.map(block => block.vehicleNo.trim() || '—').join(' / '),
        sourceBlockIds: pair.map(block => block.id), vehicleCount: pair.length })
    }
    return cards
  })
}
