const taipeiOffset = 8 * 60 * 60 * 1000;

export function preWindowInput(time: number | null | undefined) {
  return typeof time === 'number' && Number.isFinite(time)
    ? new Date(time + taipeiOffset).toISOString().slice(0, 16)
    : '';
}

export function parsePreWindowInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw Error('請完整設定開放與截止時間（台灣時間）');
  const time = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(time) || preWindowInput(time) !== value)
    throw Error('開放或截止時間格式不正確');
  return time;
}

export function preReopenDeadline(hour: string, minute: string, now = Date.now()) {
  if (!/^(?:[01]\d|2[0-3])$/.test(hour) || !/^[0-5]\d$/.test(minute))
    throw Error('請選擇截止小時與分鐘');
  const today = preWindowInput(now).slice(0, 10);
  const time = parsePreWindowInput(`${today}T${hour}:${minute}`);
  return time > now ? time : time + 86400000;
}

export function preWindowConfiguration(
  start: string,
  end: string,
  action: 'save' | 'open' | 'close',
  locked: boolean,
  now = Date.now(),
) {
  const openAt = action === 'open' ? now : parsePreWindowInput(start);
  const closeAt = parsePreWindowInput(end);
  if (openAt >= closeAt)
    throw Error(action === 'open' ? '截止時間已過，請先設定晚於目前時間的截止時間再開放' : '截止時間必須晚於開放時間');
  return { openAt, closeAt, status: action === 'close' || (action === 'save' && locked) ? 'locked' : 'open' };
}
