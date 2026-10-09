import { useCallback, useEffect, useRef } from 'react';

/**
 * Stack of open overlays (drawers and dialogs).
 *
 * Several can be open at once — a confirm dialog on top of a drawer — and a
 * keypress belongs to the top one only. Without this, Escape closes the dialog
 * *and* the drawer behind it, and Tab is trapped by both.
 */
const stack: symbol[] = [];

/** Registers an overlay while `open`; returns a check for "am I on top?". */
export function useOverlayLayer(open: boolean): () => boolean {
  const idRef = useRef(Symbol('overlay'));

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    stack.push(id);
    return () => {
      const index = stack.indexOf(id);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [open]);

  // Stable identity: callers list it as an effect dependency.
  return useCallback(() => stack[stack.length - 1] === idRef.current, []);
}

/** Always-current reference to a callback, so effects need not re-run when a parent passes a new inline function. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
