import { scheduleSections, preScheduleSource } from './pre-schedule-order.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';

export const monthRowSectionKey = (row) =>
  row.sectionKey ||
  scheduleSectionIdentity(row.section, row.areaCode || '', row.group).key;

// Persist identifiers independently of labels; retain empty sections and source order.
export function monthSectionCatalog(rows, layout) {
  if (layout?.sections) return structuredClone(layout.sections);
  const sections = new Map();
  for (const row of rows) {
    const key = monthRowSectionKey(row),
      id = `${row.group}:${key}`;
    if (!sections.has(id))
      sections.set(id, {
        key,
        group: row.group,
        section: row.section,
        areaCode: row.areaCode,
        label: scheduleSectionIdentity(
          row.section,
          row.areaCode || '',
          row.group,
        ).label,
      });
  }
  return [...sections.values()];
}

export function changeMonthSections(sections, rows, command, newKey) {
  const next = structuredClone(sections);
  if (!['day', 'night'].includes(command.group)) throw Error('請選擇組別');
  const index = next.findIndex(
    (s) => s.key === command.sectionKey && s.group === command.group,
  );
  const before = index < 0 ? null : structuredClone(next[index]);
  if (command.action === 'section-delete') {
    if (!before) throw Error('找不到區域，請重新載入');
    if (
      rows.some(
        (r) => r.group === before.group && monthRowSectionKey(r) === before.key,
      )
    )
      throw Error('此區域仍有人員，請先換區或移出人員後再刪除。');
    if (command.confirmed !== true) throw Error('請再次確認刪除區域');
    next.splice(index, 1);
  } else {
    const label = typeof command.label === 'string' ? command.label.trim() : '';
    if (!label || label.length > 100) throw Error('請輸入 1～100 字的區域名稱');
    if (
      next.some(
        (s) =>
          s.group === command.group &&
          s.label === label &&
          s.key !== before?.key,
      )
    )
      throw Error('本組已有同名區域');
    if (command.action === 'section-add') {
      // Only an explicit area name conveys a code; never guess from staff or daily shifts.
      const code = label.match(/^(?:.*\s)?(Z?[A-Z]+\d*)\s*區?$/)?.[1] || null;
      if (
        code &&
        next.some((s) => s.group === command.group && s.areaCode === code)
      )
        throw Error('本組已有此區域，請使用既有區域或編輯名稱');
      next.push({
        key: newKey,
        group: command.group,
        section: label,
        areaCode: code,
        label,
      });
    } else if (command.action === 'section-rename') {
      if (!before) throw Error('找不到區域，請重新載入');
      next[index].label = label;
    } else throw Error('不支援的區域操作');
  }
  return {
    sections: next,
    before,
    after:
      command.action === 'section-add'
        ? next.at(-1)
        : next.find(
            (s) => s.key === command.sectionKey && s.group === command.group,
          ) || null,
  };
}

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
export function monthSections(
  rows,
  group,
  layout,
  personOf = (row) => row,
  includeEmpty = false,
) {
  if (!layout) return scheduleSections(rows, group, personOf);
  const people = new Map(rows.map((row) => [personOf(row).employeeId, row]));
  const sections = new Map(
    monthSectionCatalog(layout.rows, layout)
      .filter((s) => s.group === group)
      .map((s) => [
        s.key,
        { key: s.key, areaCode: s.areaCode, label: s.label, people: [] },
      ]),
  );
  for (const entry of layout.rows) {
    if (
      entry.group !== group ||
      !people.has(entry.employeeId) ||
      layout.excludedEmployeeIds?.includes(entry.employeeId)
    )
      continue;
    sections
      .get(monthRowSectionKey(entry))
      ?.people.push(people.get(entry.employeeId));
  }
  return [...sections.values()].filter((s) => includeEmpty || s.people.length);
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
      const key = monthRowSectionKey(moved);
      const last = next.findLastIndex(
        (r) => r.group === moved.group && monthRowSectionKey(r) === key,
      );
      next.splice(last < 0 ? next.length : last + 1, 0, moved);
    } else if (command.action === 'reorder') {
      const targetIndex = next.findIndex(
        (r) => r.employeeId === command.targetEmployeeId,
      );
      if (
        targetIndex < 0 ||
        next[targetIndex].group !== next[index].group ||
        monthRowSectionKey(next[targetIndex]) !==
          monthRowSectionKey(next[index])
      )
        throw Error('只能在同一區域內拖曳排序；跨區請使用換區');
      if (!['before', 'after'].includes(command.position))
        throw Error('拖曳位置不正確');
      if (targetIndex === index) throw Error('順序未變更');
      const [moved] = next.splice(index, 1);
      const at = next.findIndex(
        (r) => r.employeeId === command.targetEmployeeId,
      );
      next.splice(at + (command.position === 'after' ? 1 : 0), 0, moved);
    } else if (['up', 'down'].includes(command.action)) {
      const identity = (r) => `${r.group}:${monthRowSectionKey(r)}`;
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
    ...(command.sectionKey ? { sectionKey: command.sectionKey } : {}),
  };
}
