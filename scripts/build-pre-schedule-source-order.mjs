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
  let headerSection = '';
  for (const [index, row] of source[key].entries()) {
    if (!row.employeeId) continue;
    const isDirector = ['調度主任', '調度副主任'].includes(row.title.trim());
    // The original leading header block has no group text on each employee row.
    // Keep its source context; a named region always wins over any foreman title.
    if (isDirector) headerSection = '單位主官';
    else if (!row.group && !row.area && row.title === '調度監控')
      headerSection = '調度監控';
    const section = isDirector
      ? '單位主官'
      : row.group || (row.area ? `${row.area}區` : headerSection || '其他人員');
    if (row.group || row.area) headerSection = '';
    const category = isDirector
      ? 'supervisor'
      : /監控/.test(section)
        ? 'monitor'
        : 'area';
    const item = {
      employeeId: row.employeeId,
      group,
      sourceSheet: sheet,
      sourceRow: Number(row.rowId.split('-').at(-1)),
      sourceOrder: index,
      section,
      category,
    };
    const old = people.get(row.employeeId);
    // Source sheet decides membership, never title or daily code. Shared unsectioned
    // header staff retain the first source; a named night team retains its placement.
    if (
      !old ||
      (old.sourceSheet !== sheet && !!row.group.trim() && group === 'night')
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
