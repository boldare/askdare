'use client';

import { useEffect } from 'react';

/**
 * Rows that scroll sideways on a phone (the theme switches) start with the current item in view,
 * not cut off past the edge.
 */
export function KeepCurrentInView() {
  useEffect(() => {
    for (const row of document.querySelectorAll<HTMLElement>('.scroller, .swatch-row')) {
      const current = row.querySelector<HTMLElement>('[aria-current]');
      if (current && row.scrollWidth > row.clientWidth) {
        row.scrollLeft = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2;
      }
    }
  }, []);
  return null;
}
