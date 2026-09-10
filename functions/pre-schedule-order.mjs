import source from './pre-schedule-source-order.json' with { type: 'json' };
import { preScheduleGroup } from './pre-schedule-domain.mjs';

// Built once from original September sheet rows, never from a daily scheduleCode.
const byEmployee = new Map(source.rows.map((row) => [row.employeeId, row]));
export function preScheduleSource(employeeId) {
  return byEmployee.get(employeeId);
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
