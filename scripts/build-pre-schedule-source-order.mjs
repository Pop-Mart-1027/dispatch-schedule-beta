// Read-only generator: prints a reviewable manifest; never writes the source sheet.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const bytes = await readFile(
  new URL('../public/september-schedules.json', import.meta.url),
);
const source = JSON.parse(bytes);
const people = new Map();
for (const [key, group, sheet] of [
  ['morning', 'day', '9月日班'],
  ['night', 'night', '9月夜班'],
]) {
  for (const [index, row] of source[key].entries()) {
    if (!row.employeeId) continue;
    const category = /調度主任|調度副主任|調度領班/.test(row.title)
      ? 'supervisor'
      : /監控/.test(row.group) || /調度監控|實習領班/.test(row.title)
        ? 'monitor'
        : 'area';
    const item = {
      employeeId: row.employeeId,
      group: category === 'area' ? group : 'day',
      sourceSheet: sheet,
      sourceRow: Number(row.rowId.split('-').at(-1)),
      sourceOrder: index,
      section:
        category === 'supervisor'
          ? '單位主官'
          : category === 'monitor'
            ? '調度監控'
            : row.group ||
              (row.area
                ? `${row.area}區`
                : row.title.includes('PT')
                  ? '支援人力'
                  : '其他人員'),
      category,
    };
    const old = people.get(row.employeeId);
    // First appearance within each source is authoritative. Shared leaders use day;
    // shared night/PT-evening-night staff keep the night vehicle-team placement.
    if (
      !old ||
      (old.sourceSheet !== sheet &&
        old.category === 'area' &&
        category === 'area' &&
        group === 'night')
    )
      people.set(row.employeeId, item);
  }
}
const ranks = { supervisor: 0, monitor: 1, area: 2 };
const rows = [...people.values()].sort(
  (a, b) =>
    a.group.localeCompare(b.group) ||
    ranks[a.category] - ranks[b.category] ||
    (a.sourceSheet === '9月日班' ? 0 : 1) -
      (b.sourceSheet === '9月日班' ? 0 : 1) ||
    a.sourceOrder - b.sourceOrder,
);
const counters = { day: 0, night: 0 };
for (const row of rows) row.scheduleDisplayOrder = counters[row.group]++;
console.log(
  JSON.stringify(
    {
      source: 'public/september-schedules.json',
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      month: source.month,
      rows,
    },
    null,
    2,
  ),
);
