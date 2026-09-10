import source from '../public/september-schedules.json';
import { PRE_CHOICES } from '../functions/pre-schedule-domain.mjs';
import { scheduleDisplayGroup } from '../functions/pre-schedule-order.mjs';
import type { ScheduleRecord } from './schedule-firestore';

export function buildScheduleEditCatalog(
  records: ScheduleRecord[],
  group: string,
) {
  const sourceCodes = source[group === 'night' ? 'night' : 'morning'].flatMap(
    (row) => row.shifts,
  );
  const recordCodes = records
    .filter((row) => scheduleDisplayGroup(row) === group)
    .map((row) => row.scheduleCode);
  const codes = [
    ...new Set(
      [...sourceCodes, ...recordCodes]
        .flatMap((code) => [code, ...code.split('／')])
        .filter((code) => code && code !== '上班' && code !== '無'),
    ),
  ];
  const isLeave = (code: string) =>
    /^(慰|事(?:假)?|病(?:假|\(聯絡單\))?|公(?:假)?|休(?:假)?|例(?:假)?|假|家庭照顧|喪(?:假)?|婚(?:假)?|特(?:休)?)$/.test(
      code,
    );
  const leaves = [
    ...new Set([...PRE_CHOICES.filter(isLeave), ...codes.filter(isLeave)]),
  ];
  const areas = new Map<string, string[]>();
  const special: string[] = [];
  for (const code of codes.filter((code) => !isLeave(code))) {
    const tokens = [
      ...new Set(code.normalize('NFKC').match(/Z?[A-X]\d*/g) || []),
    ];
    if (!tokens.length) special.push(code);
    for (const area of tokens)
      areas.set(area, [...(areas.get(area) || []), code]);
  }
  return {
    leaves,
    areas: [...areas]
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([areaCode, codes]) => ({ areaCode, codes })),
    special,
  };
}
