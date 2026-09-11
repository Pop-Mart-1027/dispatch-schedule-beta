// Valid area catalogue (areaMaster), plus R3 explicitly confirmed by operations.
// This is a validity list, not a list of Z aliases. Existing non-Z blocks also
// supply valid areas such as H. Explicit official Z codes take precedence.
const officialDispatchAreas = new Set('A1 A2 B1 B2 B3 B4 C1 C2 D1 D2 D3 E E1 E2 F G1 G2 H1 H2 I1 I2 I3 J1 J2 K1 K2 K3 K4 L1 L2 L3 L4 M N O1 O2 O3 O4 P1 P2 R R3 S T1 T2 U V W1 W2 W3 X1 X2'.split(' '))
const clean = (value: string) => value.trim().toUpperCase()

export function dispatchAreaCodes(blocks: ReadonlyArray<{ areaCode: string | null }>) {
  return new Set([...officialDispatchAreas, ...blocks.map(b => clean(b.areaCode || '')).filter(code => code && !code.startsWith('Z'))])
}

export function normalizeDispatchAreaCode(areaCode: string | null, validCodes: ReadonlySet<string> = officialDispatchAreas): string | null {
  if (!areaCode) return areaCode
  const code = clean(areaCode)
  if (validCodes.has(code)) return code
  return code.startsWith('Z') && validCodes.has(code.slice(1)) ? code.slice(1) : code
}

// Display projection only: never pass this projection into persistence/audit.
export function dispatchAreaDisplay<T extends { areaCode: string | null; areaName: string }>(block: T, validCodes: ReadonlySet<string>): T {
  const areaCode = normalizeDispatchAreaCode(block.areaCode, validCodes)
  if (!block.areaCode || areaCode === clean(block.areaCode)) return block
  const areaName = block.areaName.replace(/[A-Za-z]+\d*/g, token => clean(token) === clean(block.areaCode!) ? areaCode! : token)
  return { ...block, areaCode, areaName }
}
