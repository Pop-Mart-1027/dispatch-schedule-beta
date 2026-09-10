// Every character remains in exactly one segment. Rendering adds layout, not content.
export function formatWorkFocus(value: string) {
  const parts: { prefix: string; text: string }[] = [];
  const pattern = /(?<![A-Za-z0-9])(?:Z?[A-Z]\d*)\s*[:：]/g;
  let cursor = 0,
    match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) {
      if (parts.length)
        parts[parts.length - 1].text += value.slice(cursor, match.index);
      else parts.push({ prefix: '', text: value.slice(cursor, match.index) });
    }
    parts.push({ prefix: match[0], text: '' });
    cursor = pattern.lastIndex;
  }
  if (parts.length) parts[parts.length - 1].text += value.slice(cursor);
  else parts.push({ prefix: '', text: value });
  return parts;
}
