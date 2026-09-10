import { scheduleSections, preScheduleSource } from './pre-schedule-order.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';

// Month-only placement; eligibility and code conversion live in month-schedule-policy.
export function initialMonthRows(people) {
  return ['day', 'night'].flatMap((group) =>
    scheduleSections(people, group).flatMap((section) =>
      section.people.map((person) => ({
        employeeId: person.employeeId,
        group,
        section:
          preScheduleSource(person.employeeId)?.section ||
          person.section ||
          section.label,
        areaCode: section.areaCode,
        blankDays: [],
      })),
    ),
  );
}
export function monthSections(rows, group, layout, personOf = (row) => row) {
  if (!layout) return scheduleSections(rows, group, personOf);
  const people = new Map(rows.map((row) => [personOf(row).employeeId, row]));
  const sections = new Map();
  for (const entry of layout.rows) {
    if (entry.group !== group || !people.has(entry.employeeId) || layout.excludedEmployeeIds?.includes(entry.employeeId)) continue;
    const identity = scheduleSectionIdentity(
      entry.section,
      entry.areaCode || '',
      group,
    );
    if (!sections.has(identity.key))
      sections.set(identity.key, { ...identity, people: [] });
    sections.get(identity.key).people.push(people.get(entry.employeeId));
  }
  return [...sections.values()];
}
export function changeMonthRows(rows, command, person, monthKey) {
  const next = structuredClone(rows),
    index = next.findIndex((r) => r.employeeId === command.employeeId);
  const before = index < 0 ? null : structuredClone(next[index]);
  if (command.action === 'add') {
    if (index >= 0) throw Error('此員工已存在本月班表');
    if (!person) throw Error('只能選擇既有正式員工');
    const days = new Date(
      Number(monthKey.slice(0, 4)),
      Number(monthKey.slice(5)),
      0,
    ).getDate();
    next.push({
      employeeId: person.employeeId,
      ...target(command),
      blankDays: Array.from({ length: days }, (_, i) => String(i + 1)),
    });
  } else {
    if (index < 0) throw Error('此員工已不在本月班表，請重新載入');
    if (command.action === 'remove') {
      if (command.confirmed !== true) throw Error('請再次確認移出本月班表');
      next.splice(index, 1);
    } else if (command.action === 'move') {
      const moved = { ...next.splice(index, 1)[0], ...target(command) };
      const key = scheduleSectionIdentity(
        moved.section,
        moved.areaCode || '',
        moved.group,
      ).key;
      const last = next.findLastIndex(
        (r) =>
          r.group === moved.group &&
          scheduleSectionIdentity(r.section, r.areaCode || '', r.group).key ===
            key,
      );
      next.splice(last < 0 ? next.length : last + 1, 0, moved);
    } else if (['up', 'down'].includes(command.action)) {
      const identity = (r) =>
        `${r.group}:${scheduleSectionIdentity(r.section, r.areaCode || '', r.group).key}`;
      const peers = next
        .map((r, i) => (identity(r) === identity(next[index]) ? i : -1))
        .filter((i) => i >= 0);
      const other =
        peers[peers.indexOf(index) + (command.action === 'up' ? -1 : 1)];
      if (other === undefined) throw Error('已在該區最前／最後一位');
      [next[index], next[other]] = [next[other], next[index]];
    } else throw Error('不支援的人員操作');
  }
  return {
    rows: next,
    before,
    after: next.find((r) => r.employeeId === command.employeeId) || null,
  };
}
function target(command) {
  if (
    !['day', 'night'].includes(command.group) ||
    typeof command.section !== 'string' ||
    !command.section.trim() ||
    command.section.length > 100
  )
    throw Error('請選擇組別與區域');
  if (command.areaCode !== null && !/^[A-Z]+\d*$/.test(command.areaCode || ''))
    throw Error('區域格式不正確');
  return {
    group: command.group,
    section: command.section,
    areaCode: command.areaCode,
  };
}
