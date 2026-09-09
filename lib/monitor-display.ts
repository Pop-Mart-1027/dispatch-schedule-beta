// Presentation only: retain the source classification, without inventing a city.
export function monitorDisplayRows(taipei: string[], newTaipei: string[]) {
  return [
    { label: '台北監控', names: taipei },
    { label: '新北監控', names: newTaipei },
  ].flatMap(({ label, names }) => [...new Set(names.map(name => name.trim()).filter(Boolean))]
    .map(name => ({ label, name })))
}
