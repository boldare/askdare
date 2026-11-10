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

/** Focuses the element a ref holds, if it is in the page; says whether it did. */
export function focusElement(ref: RefObject<HTMLElement | null>): boolean {
  const element = ref.current;
  if (!element?.isConnected) return false;
  element.focus();
  return true;
}
