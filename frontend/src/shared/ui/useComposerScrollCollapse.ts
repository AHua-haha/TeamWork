import { useEffect, useState, type RefObject } from 'react';

/** Local presentation state. Only reader scrolling changes it, not streamed content. */
export function useComposerScrollCollapse(
  viewport: RefObject<HTMLElement | null>,
  composer: RefObject<HTMLElement | null>,
) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const view = viewport.current, box = composer.current;
    if (!view || !box) return;
    let lastTop = view.scrollTop;
    let direction = 0, distance = 0, lastGesture = 0;
    let draggingScrollbar = false;
    let touchY: number | undefined;
    const editing = () => box.contains(view.ownerDocument.activeElement);
    const insideComposer = (event: Event) => event.target instanceof Node && box.contains(event.target);
    const intent = (delta: number) => {
      if (!delta || editing()) return;
      const next = Math.sign(delta);
      if (direction !== next || Date.now() - lastGesture > 250) distance = 0;
      direction = next;
      lastGesture = Date.now();
      distance += Math.abs(delta);
      if (distance >= 12 && (delta > 0 || view.scrollTop > 0)) setCompact(delta < 0);
    };
    const scrollsInside = (event: Event, delta: number) => {
      // A scrollable code block or tool result consumes its own gesture first.
      let node = event.target instanceof Element ? event.target : null;
      while (node && node !== view) {
        if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)
          && (delta < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight)) return true;
        node = node.parentElement;
      }
      return false;
    };
    const onWheel = (event: WheelEvent) => {
      if (insideComposer(event) || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || scrollsInside(event, event.deltaY)) return;
      intent(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.clientHeight : 1));
    };
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (!insideComposer(event) && nextY !== undefined && touchY !== undefined && !scrollsInside(event, touchY - nextY)) intent(touchY - nextY);
      touchY = nextY;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (insideComposer(event) || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable=true]')) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) intent(-16);
      else if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) intent(16);
    };
    const onPointerDown = (event: PointerEvent) => { draggingScrollbar = event.target === view; };
    const onPointerUp = () => { draggingScrollbar = false; };
    const onScroll = () => {
      const delta = view.scrollTop - lastTop;
      lastTop = view.scrollTop;
      if (draggingScrollbar) intent(delta);
    };
    const onFocus = () => { distance = 0; setCompact(false); };

    view.addEventListener('wheel', onWheel, { passive: true });
    view.addEventListener('touchstart', onTouchStart, { passive: true });
    view.addEventListener('touchmove', onTouchMove, { passive: true });
    view.addEventListener('keydown', onKeyDown);
    view.addEventListener('pointerdown', onPointerDown);
    view.addEventListener('scroll', onScroll, { passive: true });
    view.ownerDocument.addEventListener('pointerup', onPointerUp);
    view.ownerDocument.addEventListener('pointercancel', onPointerUp);
    box.addEventListener('focusin', onFocus);
    return () => {
      view.removeEventListener('wheel', onWheel);
      view.removeEventListener('touchstart', onTouchStart);
      view.removeEventListener('touchmove', onTouchMove);
      view.removeEventListener('keydown', onKeyDown);
      view.removeEventListener('pointerdown', onPointerDown);
      view.removeEventListener('scroll', onScroll);
      view.ownerDocument.removeEventListener('pointerup', onPointerUp);
      view.ownerDocument.removeEventListener('pointercancel', onPointerUp);
      box.removeEventListener('focusin', onFocus);
    };
  }, [viewport, composer]);

  return compact;
}
