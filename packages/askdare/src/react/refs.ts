import { type Ref, type RefCallback, type RefObject, useCallback } from 'react';

/** One ref callback for a primitive's own ref and the one its user passed as a prop. */
export function useMergedRef<T>(
  own: RefObject<T | null>,
  passed: Ref<T> | undefined,
): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      own.current = node;
      if (typeof passed === 'function') passed(node);
      else if (passed) passed.current = node;
    },
    [own, passed],
  );
}

/** Where a chat ends, tried in order: its panel, its theme root, its message form. */
const CHAT_BOUNDARIES = [
  '[data-ask-part="panel"]',
  '[data-askdare-root]',
  '[data-ask-part="composer"]',
] as const;

/**
 * Focuses the element a ref holds, if it is in the page; says whether it handled the request.
 * Unless the request is `explicit`, focus moves only from inside the chat or from nowhere (the
 * body), so an answer never pulls focus out of the page's own form, and the page doesn't scroll.
 */
export function focusElement(ref: RefObject<HTMLElement | null>, explicit = false): boolean {
  const element = ref.current;
  if (!element?.isConnected) return false;
  if (explicit) {
    element.focus();
    return true;
  }
  const { activeElement, body, documentElement } = element.ownerDocument;
  const chat =
    CHAT_BOUNDARIES.map((selector) => element.closest(selector)).find(Boolean) ?? element;
  const nowhere = !activeElement || activeElement === body || activeElement === documentElement;
  if (nowhere || chat.contains(activeElement)) element.focus({ preventScroll: true });
  return true;
}
