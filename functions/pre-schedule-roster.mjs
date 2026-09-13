import { preScheduleRoster, preScheduleSource, preScheduleEntry, scheduleSections } from './pre-schedule-order.mjs';
import { scheduleSectionIdentity } from './schedule-section-key.mjs';

// Optional layout belongs only to this month's roster, never the employee master.
export function monthlyRoster(people) {
  return preScheduleRoster(people).map(person => ({
    ...person,
    group: ['day', 'night'].includes(person.rosterGroup) ? person.rosterGroup : person.group,
  })).sort((a, b) => (a.rosterOrder ?? Number.MAX_SAFE_INTEGER) - (b.rosterOrder ?? Number.MAX_SAFE_INTEGER));
}
export function monthlySection(person) {
  return scheduleSectionIdentity(
    person.rosterSection ?? preScheduleSource(person.employeeId)?.section ?? person.section ?? '',
    person.areaCode || person.area || '', person.group,
  );
}
export function monthlySections(rows, group, personOf = row => row) {
  if (!rows.some(row => {
    const p = personOf(row);
    return p.rosterSection !== undefined || p.rosterGroup !== undefined || p.rosterOrder !== undefined;
  })) return scheduleSections(rows, group, personOf);
  const byId = new Map(rows.map(row => [personOf(row).employeeId, row]));
  const sections = new Map();
  for (const p of monthlyRoster(rows.map(personOf))) {
    if (group && p.group !== group) continue;
    const identity = monthlySection(p);
    const key = `${p.group}:${identity.key}`;
    if (!sections.has(key)) sections.set(key, { ...identity, people: [] });
    sections.get(key).people.push(byId.get(p.employeeId));
  }
  return [...sections.values()];
}
export function monthlyEntry(entry, people) {
  const projected = preScheduleEntry(entry);
  const person = people.find(p => p.employeeId === entry?.employeeId);
  return projected && person ? { ...projected, group: person.group } : projected;
}
export function placeMonthlyPerson(people, person, beforeId = '') {
  const ordered = ['day', 'night'].flatMap(group => monthlySections(people, group).flatMap(s => s.people));
  const rest = ordered.filter(p => p.employeeId !== person.employeeId);
  const sameSection = p => p.group === person.group && monthlySection(p).key === monthlySection(person).key;
  let index;
  if (beforeId) {
    index = rest.findIndex(p => p.employeeId === beforeId && sameSection(p));
    if (index < 0) throw Error('移動目標已變更，請重新載入人員名單');
  } else {
    index = rest.findLastIndex(sameSection);
    if (index < 0) index = rest.findLastIndex(p => p.group === person.group);
    index = index < 0 ? rest.length : index + 1;
  }
  rest.splice(index, 0, person);
  return rest.map((p, rosterOrder) => ({ ...p, rosterOrder }));
}
