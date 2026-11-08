/** Teclas pulsadas (por `event.code`). Se alimenta con `attachKeyboard()` desde el controlador. */
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
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
    down.clear();
  };
}
