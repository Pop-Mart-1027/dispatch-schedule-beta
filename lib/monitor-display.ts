// Presentation only: retain the source classification, without inventing a city.
export function monitorDisplayRows(taipei: string[], newTaipei: string[], peoplePerRow: 1 | 3 = 1) {
  return [
    { label: '台北監控', names: taipei },
    { label: '新北監控', names: newTaipei },
  ].flatMap(({ label, names }) => {
    const uniqueNames = [...new Set(names.map(name => name.trim()).filter(Boolean))]
    return Array.from({ length: Math.ceil(uniqueNames.length / peoplePerRow) }, (_, index) => ({
      label,
      name: uniqueNames.slice(index * peoplePerRow, (index + 1) * peoplePerRow).join('、'),
    }))
  })
}
