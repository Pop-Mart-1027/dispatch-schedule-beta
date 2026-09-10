// Schedule presentation only. These aliases must never feed assignment or stored codes.
const nightLabelAliases = {
  F1: 'F',
  I2: 'I',
  ZH2: 'ZH',
  M2: 'M',
  W3: 'W1',
  W2: 'W2',
};
export function getScheduleAreaDisplayLabel(section, sourceGroup = '') {
  const text = String(section || '')
    .normalize('NFKC')
    .replace(/〇/g, 'O')
    .trim();
  if (/^工兵小隊(?:\s*[-－].*)?$/.test(text)) return '工兵小隊';
  if (['J2區', 'J2', '晚PT數字', '府前PT'].includes(text)) return '府前PT';
  const match = text.match(/^(Z?[A-Z]+\d*)\s*區$/i);
  // No source group means no numeric alias. Never infer it from a daily work code.
  const isNightSource = [
    'night',
    'small-night',
    '9月夜班',
    '大小夜班',
  ].includes(sourceGroup);
  if (match) {
    const code = match[1].toUpperCase();
    return `${(isNightSource && nightLabelAliases[code]) || code}區`;
  }
  return text;
}

// Return the FIRST rendered target in each navigation family, never merge sections.
export function getAreaJumpOptions(areas) {
  const options = new Map();
  for (const area of areas) {
    const code = String(area.areaCode || '').toUpperCase();
    const family = /^ZH\d*$/.test(code)
      ? 'ZH'
      : code.match(/^Z?([A-X])\d*$/)?.[1];
    const label =
      family ||
      (/監控/.test(area.label)
        ? '監控'
        : getScheduleAreaDisplayLabel(area.label));
    const key = family ? `family:${family}` : `special:${label}`;
    if (!options.has(key))
      options.set(key, { ...area, label, navigationFamily: family || null });
  }
  return [...options.values()].sort((a, b) => {
    if (!a.navigationFamily || !b.navigationFamily)
      return Number(!!a.navigationFamily) - Number(!!b.navigationFamily);
    return a.navigationFamily.localeCompare(b.navigationFamily, 'en');
  });
}
