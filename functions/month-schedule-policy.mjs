// Shared month-level eligibility; raw historical records are never deleted.
export function monthParticipation(layout, employeeId, date) {
  if (!layout || layout.monthKey !== date.slice(0, 7)) return true;
  if ((layout.excludedEmployeeIds || []).includes(employeeId)) return false;
  const row = layout.rows.find(r => r.employeeId === employeeId);
  return !row?.blankDays?.includes(String(Number(date.slice(8, 10))));
}

export function eligibleMonthSchedules(records, layout) {
  return records.filter(record => monthParticipation(layout, record.employeeId, record.date));
}

export function eligibleMonthBlocks(blocks, layout) {
  return blocks.map(block => {
    const resets = layout?.monthKey === block.date.slice(0, 7) ? layout.assignmentResetAt?.[block.date] || {} : {};
    const resetIds = Object.keys(resets).filter(id => timestamp(resets[id]) > 0 && timestamp(block.modifiedAt) <= timestamp(resets[id]));
    return {
      ...block,
      // Read-time metadata only. Never written into dispatchBlocks.
      monthAssignmentResetIds: resetIds,
      ...Object.fromEntries(['drivers', 'stations', 'assistants'].map(role => [
        role, block[role].filter(person => monthParticipation(layout, person.employeeId, block.date) && !resetIds.includes(person.employeeId)),
      ])),
    };
  });
}

function timestamp(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return (value?.seconds ?? value?._seconds ?? 0) * 1000 + (value?.nanoseconds ?? value?._nanoseconds ?? 0) / 1e6;
}

// Preserve spelling, shift, holiday prefix and hours. Only the first area token
// of each work instruction is its destination, not an area in a trailing note.
export function moveWorkArea(code, from, to) {
  if (!from || !to || from === to) return code;
  return code.split(/([／/、])/).map(part => {
    if (/^\s*(?:休(?!上)|例|病|事|慰|公|假|特休|家庭照顧|喪|婚)/.test(part)) return part;
    const token = /[A-Z]+\d*/.exec(part);
    if (!token || token[0] !== from) return part;
    const prefix = part.slice(0, token.index).trim();
    if (!/^(?:國上|休上)?(?:小夜|早|晚|夜)?$/.test(prefix)) return part;
    return part.slice(0, token.index) + to + part.slice(token.index + from.length);
  }).join('');
}
