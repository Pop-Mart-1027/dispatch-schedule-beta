import source from './pre-schedule-source-order.json' with { type: 'json' };
import { preScheduleGroup } from './pre-schedule-domain.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';

// Built once from original September sheet rows, never from a daily scheduleCode.
const byEmployee = new Map(source.rows.map((row) => [row.employeeId, row]));
export function preScheduleSource(employeeId) {
  return byEmployee.get(employeeId);
}
export function scheduleDisplayGroup(person, fallback = 'day') {
  return (
    byEmployee.get(person.employeeId)?.group ||
    (['day', 'night'].includes(person.group)
      ? person.group
      : preScheduleGroup(person)) ||
    fallback
  );
}
export function scheduleSections(rows, group, personOf = (row) => row) {
  const sections = new Map();
  const selected = rows
    .filter(
      (row) => !group || scheduleDisplayGroup(personOf(row), group) === group,
    )
    .slice()
    .sort((a, b) => preScheduleDisplayOrder(personOf(a), personOf(b)));
  for (const row of selected) {
    const person = personOf(row),
      source = byEmployee.get(person.employeeId);
    const section =
      source?.section ||
      person.section ||
      (!['day', 'night', 'morning'].includes(person.group)
        ? person.group
        : '') ||
      '';
    const identity = scheduleSectionIdentity(
      section,
      person.areaCode || person.area || '',
    );
    if (!sections.has(identity.key))
      sections.set(identity.key, { ...identity, people: [] });
    sections.get(identity.key).people.push(row);
  }
  return [...sections.values()];
}
export function preScheduleDisplayOrder(a, b) {
  return (
    (byEmployee.get(a.employeeId)?.scheduleDisplayOrder ??
      Number.MAX_SAFE_INTEGER) -
    (byEmployee.get(b.employeeId)?.scheduleDisplayOrder ??
      Number.MAX_SAFE_INTEGER)
  );
}
export function preScheduleRoster(people) {
  return people
    .map((person) => ({
      ...person,
      group:
        byEmployee.get(person.employeeId)?.group ||
        (['day', 'night'].includes(person.group)
          ? person.group
          : preScheduleGroup(person)),
    }))
    .sort(preScheduleDisplayOrder);
}
// Read projection only: preserve existing entries, values, revisions and timestamps.
export function preScheduleEntry(entry) {
  return entry && byEmployee.has(entry.employeeId)
    ? { ...entry, group: byEmployee.get(entry.employeeId).group }
    : entry;
}
