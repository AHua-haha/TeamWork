/** Match the docked/overlay breakpoints while keeping room for the chat on desktop. */
export function panelSize(containerWidth: number, viewportWidth: number) {
  const overlay = viewportWidth <= 1100;
  const available = Math.max(0, overlay ? viewportWidth - 56 : containerWidth);
  const min = Math.min(320, available);
  const max = overlay ? available : Math.max(min, available - 280);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const initial = clamp(overlay ? Math.min(880, available) : Math.max(480, Math.min(980, containerWidth * .52)));
  return { min, max, initial, clamp };
}
