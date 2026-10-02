/**
 * @typedef {{onboardingStartedAt?: string, onboardingHighlightUntil?: string}} NewHireFields
 */

/** @param {NewHireFields | undefined} person @param {number} now */
export function isNewHireHighlighted(person, now = Date.now()) {
  if (!person?.onboardingStartedAt || !person.onboardingHighlightUntil) return false;
  const start = Date.parse(person.onboardingStartedAt);
  const end = Date.parse(person.onboardingHighlightUntil);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(now)
    && start < end && start <= now && now < end;
}

/** @param {NewHireFields} person */
export function newHireHighlightTitle(person) {
  const end = Date.parse(person.onboardingHighlightUntil || '');
  if (!Number.isFinite(end)) return '新進人員';
  const date = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(end));
  return `新進人員，${date} 起恢復一般顯示`;
}
