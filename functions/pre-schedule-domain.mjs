// Existing employee pre-schedule values and checks, shared by client and server.
export const PRE_CHOICES = ['上班', '休', '休上', '例', '慰', '病', '事', '特'];
export function monthDays(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error('月份格式不正確');
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}
export function assessDays(month, days) {
  const length = monthDays(month);
  const valid =
    Array.isArray(days) &&
    days.length === length &&
    days.every((x) => x === '' || PRE_CHOICES.includes(x));
  const incomplete = !valid || days.some((x) => !x);
  const issues = [];
  if (!valid) issues.push('天數或班別值不正確');
  if (valid) {
    const offset = new Date(`${month}-01T00:00:00Z`).getUTCDay();
    for (let start = 0; start + 7 <= length; start++) {
      if ((offset + start) % 7 !== 0) continue;
      const week = days.slice(start, start + 7);
      if (
        !week.includes('例') ||
        !week.some((x) => x === '休' || x.includes('休上')) ||
        !week.includes('上班')
      )
        issues.push(`${start + 1}～${start + 7} 日需有例、休／休上與上班`);
    }
    let run = 0;
    for (const value of days) {
      run = value === '上班' ? run + 1 : 0;
      if (run === 6) issues.push('連續上班超過 5 天');
    }
  }
  return {
    valid,
    incomplete,
    issues,
    abnormal: issues.length > 0,
    canSubmit: !incomplete && !issues.length,
  };
}
// Formal schedule shiftType is authoritative; small-night is part of night.
export function preScheduleGroup(profile, formalShift) {
  const shift = formalShift || profile.shiftType || profile.shiftGroup;
  if (['night', 'small-night', '夜班', '小夜班', '小夜'].includes(shift))
    return 'night';
  if (['morning', 'day', '早班', '早班組'].includes(shift)) return 'day';
  return null;
}
export function effectiveMonthStatus(month, now = Date.now()) {
  if (month.status === 'published') return month.status;
  return month.closeAt && now >= month.closeAt ? 'reviewing' : month.status;
}
export function mayEmployeeEdit(month, now = Date.now()) {
  return (
    !month.publishJob &&
    effectiveMonthStatus(month, now) === 'open' &&
    !!month.openAt &&
    !!month.closeAt &&
    now >= month.openAt &&
    now < month.closeAt
  );
}
export function mayReview(month, now = Date.now()) {
  return (
    !month.publishJob &&
    month.status !== 'published' &&
    !!month.closeAt &&
    now >= month.closeAt
  );
}
// Employee requests stay in days; only reviewers may write arrangedDays.
// null means "use the request", while an explicit empty string remains incomplete.
export function reviewedDays(monthKey, entry) {
  const length = monthDays(monthKey),
    days = entry?.days || Array(length).fill('');
  if (!Array.isArray(days) || days.length !== length) return [];
  if (entry?.arrangedDays === undefined) return days;
  if (
    !Array.isArray(entry.arrangedDays) ||
    entry.arrangedDays.length !== length
  )
    return [];
  return entry.arrangedDays.map((code, index) =>
    code === null ? days[index] : code,
  );
}
export function assessArrangement(monthKey, entry, formalCodes = []) {
  const days = reviewedDays(monthKey, entry),
    known = new Set(formalCodes);
  const invalid =
    days.length !== monthDays(monthKey) ||
    days.some(
      (code) =>
        typeof code !== 'string' ||
        (!PRE_CHOICES.includes(code) && code !== '' && !known.has(code)),
    );
  const pendingIndices = days.flatMap((code, index) =>
    typeof code === 'string' &&
    code.split(/[／/]/).some((part) => part.trim() === '上班')
      ? [index]
      : [],
  );
  const checks = assessDays(
    monthKey,
    days.map((code) =>
      PRE_CHOICES.includes(code) || code === ''
        ? code
        : known.has(code)
          ? { 病假: '病', 事假: '事', 特休: '特', 例假: '例', 休假: '休' }[
              code
            ] || '上班'
          : code,
    ),
  );
  return {
    ...checks,
    valid: !invalid,
    incomplete: invalid || days.some((code) => !code),
    abnormal: invalid || checks.abnormal,
    pendingIndices,
    unarranged: pendingIndices.length,
    days,
  };
}
export function publicationSummary(
  monthKey,
  roster,
  entries,
  existingCount,
  catalog = { day: [], night: [] },
) {
  const byId = new Map(entries.map((x) => [x.employeeId, x]));
  const rows = roster.map((person) => {
    const entry = byId.get(person.employeeId);
    const checks = assessArrangement(
      monthKey,
      entry,
      catalog[person.group] || [],
    );
    const identityInvalid =
      !person.group ||
      (entry &&
        (entry.group !== person.group ||
          entry.employeeName !== person.name ||
          entry.jobTitle !== person.title));
    return { person, entry, checks, identityInvalid };
  });
  return {
    monthKey,
    expected: roster.length,
    day: roster.filter((x) => x.group === 'day').length,
    night: roster.filter((x) => x.group === 'night').length,
    submitted: rows.filter((x) => x.entry?.submitted).length,
    unsubmitted: rows.filter((x) => !x.entry?.submitted).length,
    incomplete: rows.filter((x) => x.checks.incomplete).length,
    abnormal: rows.filter((x) => x.identityInvalid || x.checks.abnormal).length,
    blocking:
      rows.filter(
        (x) => x.identityInvalid || x.checks.incomplete || x.checks.unarranged,
      ).length +
      entries.filter((x) => !roster.some((p) => p.employeeId === x.employeeId))
        .length,
    genericWorkDays: rows.reduce((n, x) => n + x.checks.unarranged, 0),
    unarrangedWorkDays: rows.reduce((n, x) => n + x.checks.unarranged, 0),
    unarrangedGroups: {
      day: rows
        .filter((x) => x.person.group === 'day')
        .reduce((n, x) => n + x.checks.unarranged, 0),
      night: rows
        .filter((x) => x.person.group === 'night')
        .reduce((n, x) => n + x.checks.unarranged, 0),
    },
    existingCount,
  };
}
export function toFormalRecords(
  monthKey,
  roster,
  entries,
  actor,
  catalog = { day: [], night: [] },
) {
  const byId = new Map(entries.map((x) => [x.employeeId, x]));
  return roster.flatMap((person) => {
    const entry = byId.get(person.employeeId);
    const checks = assessArrangement(
      monthKey,
      entry,
      catalog[person.group] || [],
    );
    if (checks.unarranged)
      throw Error(`尚有 ${checks.unarranged} 個出勤班次未完成班別／區域安排`);
    if (!entry || !person.group || checks.incomplete)
      throw Error('預排尚未完整，不可補猜班別');
    return checks.days.map((code, index) => {
      const date = `${monthKey}-${String(index + 1).padStart(2, '0')}`;
      return {
        id: `${person.employeeId}_${date}`,
        date,
        employeeId: person.employeeId,
        employeeName: person.name,
        title: person.title,
        shiftType: person.group === 'night' ? 'night' : 'morning',
        scheduleCode: code,
        scheduleLabel: code,
        leaveType:
          { 病: '病假', 事: '事假', 特: '特休' }[code] ||
          ([
            '休',
            '休上',
            '例',
            '慰',
            '病假',
            '事假',
            '特休',
            '例假',
            '休假',
          ].includes(code)
            ? code
            : ''),
        source: `preScheduleMonths/${monthKey}/entries/${person.employeeId}`,
        status: 'active',
        note: entry.note || '',
        modifiedBy: actor,
      };
    });
  });
}
