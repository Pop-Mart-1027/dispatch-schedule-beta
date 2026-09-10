import { getScheduleAreaDisplayLabel } from './schedule-display.mjs';
// Display identity only. Never parse a daily work code or change assignment areas.
export function scheduleSectionIdentity(
  section = '',
  fallbackArea = '',
  sourceGroup = '',
) {
  const text = String(section).normalize('NFKC').replace(/〇/g, 'O').trim();
  const specialLabel = getScheduleAreaDisplayLabel(text, sourceGroup);
  if (['府前PT', '工兵小隊', 'B區PT'].includes(specialLabel))
    return {
      key: `section:${specialLabel}`,
      areaCode: null,
      label: specialLabel,
    };
  const match = text.match(/^(?:.*\s)?(Z?[A-Z]+\d*)\s*區(?:.*)?$/i);
  const areaCode =
    match?.[1]?.toUpperCase() ||
    (!text && /^[A-Z]+\d*$/i.test(fallbackArea)
      ? fallbackArea.toUpperCase()
      : null);
  return areaCode
    ? {
        key: `area:${areaCode}`,
        areaCode,
        label: getScheduleAreaDisplayLabel(`${areaCode}區`, sourceGroup),
      }
    : {
        key: `section:${text || '其他人員'}`,
        areaCode: null,
        label: text || '其他人員',
      };
}
