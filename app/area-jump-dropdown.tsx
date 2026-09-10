'use client';
import { useEffect, useRef, type RefObject } from 'react';
import './area-jump-dropdown.css';

export type JumpArea = { key: string; label: string; areaCode: string | null };
export function scheduleSectionId(scope: string, group: string, key: string) {
  return `${scope}-${group}-${encodeURIComponent(key)}`;
}
export function AreaJumpDropdown({
  areas,
  group,
  scope,
  scrollTarget,
}: {
  areas: JumpArea[];
  group: string;
  scope: string;
  scrollTarget: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [group, areas]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const jump = (key: string) => {
    const container = scrollTarget.current,
      target = document.getElementById(scheduleSectionId(scope, group, key));
    if (container && target && container.contains(target)) {
      const header =
        container.querySelector('thead')?.getBoundingClientRect().height || 0;
      container.scrollTo({
        top:
          container.scrollTop +
          target.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          container.clientTop -
          header,
        left: container.scrollLeft,
        behavior: 'auto',
      });
    }
    if (ref.current) ref.current.open = false;
    ref.current?.querySelector('summary')?.focus({ preventScroll: true });
  };
  return (
    <details ref={ref} className="area-jump-dropdown">
      <summary>
        跳到區域 <span aria-hidden="true">▼</span>
      </summary>
      <div className="area-jump-panel" aria-label="區域跳轉選單">
        {areas.length ? (
          areas.map((area) => (
            <button key={area.key} type="button" onClick={() => jump(area.key)}>
              {area.label}
            </button>
          ))
        ) : (
          <p>目前沒有可跳轉的區域</p>
        )}
      </div>
    </details>
  );
}
