import { type RefObject, useEffect } from 'react';

/**
 * 让容器可被其 handle 元素拖动（基于 transform，不影响原有布局）。
 * - handleRef: 拖拽手柄（通常是标题栏）
 * - targetRef: 被移动的容器
 * 手柄内的 button/input/select/textarea/a 不会触发拖拽，保证按钮可点击。
 */
export function useDraggable(
  handleRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const handle = handleRef.current;
    const target = targetRef.current;
    if (!handle || !target) return;

    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('button, input, select, textarea, a, [data-no-drag]')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const m = new DOMMatrixReadOnly(getComputedStyle(target).transform);
      baseX = m.m41;
      baseY = m.m42;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      target.style.transform = `translate(${baseX + dx}px, ${baseY + dy}px)`;
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    handle.addEventListener('pointerdown', onDown);
    return () => handle.removeEventListener('pointerdown', onDown);
  }, [handleRef, targetRef]);
}
