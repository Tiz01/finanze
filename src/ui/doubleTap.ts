const WINDOW_MS = 350;
const NEARBY_PX = 40;

/**
 * Su iOS due tocchi rapidi nello stesso punto ingrandiscono la pagina, anche con `touch-action: manipulation`.
 * Si annulla il secondo tocco: il tastierino non ne risente perché reagisce a `pointerdown`.
 * I campi di testo restano esclusi: lì il doppio tocco serve a selezionare una parola.
 */
export function preventDoubleTapZoom(): void {
  let lastAt = -Infinity;
  let lastX = 0;
  let lastY = 0;

  document.addEventListener(
    'touchend',
    (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const repeated =
        event.timeStamp - lastAt < WINDOW_MS && Math.abs(touch.clientX - lastX) < NEARBY_PX && Math.abs(touch.clientY - lastY) < NEARBY_PX;
      lastAt = event.timeStamp;
      lastX = touch.clientX;
      lastY = touch.clientY;

      const inField = event.target instanceof Element && event.target.closest('input, textarea, select');
      if (repeated && !inField) event.preventDefault();
    },
    { passive: false },
  );
}
