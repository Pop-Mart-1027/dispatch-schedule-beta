'use client';
import { useEffect, useRef, useState } from 'react';
import { formatWorkFocus } from '../lib/work-focus';
import './work-focus.css';
export function WorkFocus({
  text,
  collapsible = false,
}: {
  text: string;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || !collapsible) return;
    const measure = () =>
      setOverflow(
        node.scrollHeight >
          parseFloat(getComputedStyle(node).lineHeight) * 3 + 2,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, collapsible]);
  return (
    <div className="work-focus">
      <div
        ref={ref}
        className={
          collapsible && !expanded
            ? 'work-focus-text collapsed'
            : 'work-focus-text'
        }
      >
        {formatWorkFocus(text || '—').map((part, i) => (
          <div key={i}>
            {part.prefix && <strong>{part.prefix}</strong>}
            {part.text}
          </div>
        ))}
      </div>
      {collapsible && overflow && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收合' : '展開'}
        </button>
      )}
    </div>
  );
}
