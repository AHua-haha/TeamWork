import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { panelSize } from './panel-size.js';
const preference = 'rsi.workspace-panel-width';
type Controls = { start(event: PointerEvent<HTMLDivElement>): void; move(event: PointerEvent<HTMLDivElement>): void; finish(): void; key(event: KeyboardEvent<HTMLDivElement>): void };

/** Resizes only the panel element; pointer movement never rerenders context/history content. */
export function WorkspaceResizeHandle({disabled = false}: {disabled?: boolean}) {
  const handle = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [size, setSize] = useState({min: 320, max: 980, width: 480});
  useEffect(() => {
    if (disabled || !handle.current) return;
    const grip = handle.current, panel = grip.closest<HTMLElement>('.workspace-panel'), container = panel?.parentElement;
    if (!panel || !container) return;
    let desired: number | undefined;
    try { const saved = Number(sessionStorage.getItem(preference)); if (Number.isFinite(saved) && saved > 0) desired = saved; } catch { /* Layout remains usable without storage. */ }
    let width = 0, drag: {pointer: number; x: number; width: number} | null = null;
    const bounds = () => panelSize(container.getBoundingClientRect().width, window.innerWidth);
    function apply(value?: number) {
      const limits = bounds(); width = Math.round(limits.clamp(value ?? desired ?? limits.initial));
      panel!.style.setProperty('--workspace-panel-width', `${width}px`);
      panel!.setAttribute('data-resizable', 'true');
      setSize(old => old.width === width && old.min === limits.min && old.max === limits.max ? old : {min: limits.min, max: limits.max, width});
    }
    function save() { desired = width; try { sessionStorage.setItem(preference, String(width)); } catch { /* Session-only fallback. */ } }
    function finish() {
      if (!drag) return;
      const pointer = drag.pointer; drag = null; save();
      panel!.classList.remove('is-resizing'); document.documentElement.classList.remove('workspace-resizing');
      if (grip.hasPointerCapture(pointer)) grip.releasePointerCapture(pointer);
    }
    controls.current = {
      start(event) {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); grip.focus();
        drag = {pointer: event.pointerId, x: event.clientX, width: panel!.getBoundingClientRect().width};
        grip.setPointerCapture(event.pointerId);
        panel!.classList.add('is-resizing'); document.documentElement.classList.add('workspace-resizing');
      },
      move(event) { if (drag?.pointer === event.pointerId) apply(drag.width + drag.x - event.clientX); },
      finish,
      key(event) {
        const limits = bounds(), step = event.shiftKey ? 64 : 24;
        const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : undefined;
        if (next === undefined) return;
        event.preventDefault(); apply(next); save();
      },
    };
    apply();
    const observer = new ResizeObserver(() => apply(drag ? width : undefined)); observer.observe(container);
    window.addEventListener('resize', resized); window.addEventListener('blur', finish);
    function resized() { finish(); apply(); }
    return () => {
      observer.disconnect(); window.removeEventListener('resize', resized); window.removeEventListener('blur', finish);
      finish(); controls.current = null; panel.removeAttribute('data-resizable');
    };
  }, [disabled]);
  if (disabled) return null;
  return <div ref={handle} className="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical"
    aria-valuemin={size.min} aria-valuemax={size.max} aria-valuenow={size.width} aria-valuetext={`${size.width} pixels wide`} tabIndex={0}
    title="Drag left to widen, right to narrow. Arrow keys also resize."
    onPointerDown={event => controls.current?.start(event)} onPointerMove={event => controls.current?.move(event)}
    onPointerUp={() => controls.current?.finish()} onPointerCancel={() => controls.current?.finish()} onLostPointerCapture={() => controls.current?.finish()}
    onKeyDown={event => controls.current?.key(event)} />;
}
