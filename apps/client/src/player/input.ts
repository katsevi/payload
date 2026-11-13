/**
 * Teclas pulsadas (por `event.code`). Se alimenta con `attachKeyboard()` desde el controlador. El botón
 * izquierdo del ratón cuenta como la tecla `Mouse0` (extintor, pulsos y sellado de las averías).
 */
export const MOUSE_PRIMARY = 'Mouse0';
const down = new Set<string>();

export const isDown = (code: string): boolean => down.has(code);

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

export function attachKeyboard(): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (!isTyping(e)) down.add(e.code);
  };
  const onUp = (e: KeyboardEvent) => down.delete(e.code);
  const onBlur = () => down.clear();
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) down.add(MOUSE_PRIMARY);
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) down.delete(MOUSE_PRIMARY);
  };
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    down.clear();
  };
}
